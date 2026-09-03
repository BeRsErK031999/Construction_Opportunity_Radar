import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SECRET_FILE_NAMES =
  /(?:^|\/)(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:key|p12|pfx|pem))$/i;
const HIGH_CONFIDENCE_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{35}\b/],
  ["npm-token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["stripe-secret-key", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ["telegram-bot-token", /\b\d{6,12}:[A-Za-z0-9_-]{32,64}\b/],
];

const git = (arguments_, encoding = "utf8") =>
  execFileSync("git", arguments_, {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

const parseNullSeparated = (value) => value.split("\0").filter((item) => item.length > 0);

const isText = (buffer) => buffer.length <= MAX_FILE_BYTES && !buffer.includes(0);

const scanText = (source, text, findings) => {
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    for (const [patternName, pattern] of HIGH_CONFIDENCE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ line: index + 1, patternName, source });
      }
    }
  }
};

const inspectTrackedPath = (path, source, findings) => {
  if (SECRET_FILE_NAMES.test(path) && basename(path).toLowerCase() !== ".env.example") {
    findings.push({ line: 0, patternName: "tracked-secret-file", source });
  }
};

const scanWorkingTree = (findings) => {
  const candidatePaths = parseNullSeparated(
    git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
  );
  for (const path of candidatePaths) {
    inspectTrackedPath(path, path, findings);
    const buffer = readFileSync(path);
    if (isText(buffer)) {
      scanText(path, buffer.toString("utf8"), findings);
    }
  }
  return candidatePaths.length;
};

const scanHistory = (findings) => {
  const commits = git(["rev-list", "--all"]).trim().split(/\r?\n/u).filter(Boolean);
  const blobs = new Map();
  for (const commit of commits) {
    for (const entry of parseNullSeparated(git(["ls-tree", "-r", "-z", commit]))) {
      const [metadata, path] = entry.split("\t", 2);
      const [, type, objectId] = metadata.split(" ");
      if (type === "blob" && objectId !== undefined && path !== undefined && !blobs.has(objectId)) {
        blobs.set(objectId, `${commit.slice(0, 12)}:${path}`);
      }
    }
  }
  for (const [objectId, source] of blobs) {
    const path = source.slice(source.indexOf(":") + 1);
    inspectTrackedPath(path, source, findings);
    const buffer = git(["cat-file", "blob", objectId], "buffer");
    if (isText(buffer)) {
      scanText(source, buffer.toString("utf8"), findings);
    }
  }
  return blobs.size;
};

const findings = [];
const candidateFiles = scanWorkingTree(findings);
const historicalBlobs = process.argv.includes("--history") ? scanHistory(findings) : 0;

if (findings.length > 0) {
  for (const finding of findings) {
    const location = finding.line === 0 ? finding.source : `${finding.source}:${finding.line}`;
    process.stderr.write(`Potential secret (${finding.patternName}) at ${location}\n`);
  }
  process.stderr.write(`Secret scan failed with ${String(findings.length)} finding(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Secret scan passed: ${String(candidateFiles)} candidate files, ${String(historicalBlobs)} historical blobs\n`,
  );
}
