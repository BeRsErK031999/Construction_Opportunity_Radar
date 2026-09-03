import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

export interface HttpTransportRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly url: string;
}

export interface HttpTransportResponse {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface HttpTransport {
  request(request: HttpTransportRequest): Promise<HttpTransportResponse>;
}

export type HttpTransportErrorCode =
  | "HTTP_REDIRECT_LIMIT"
  | "HTTP_REQUEST_FAILED"
  | "HTTP_RESPONSE_TOO_LARGE"
  | "HTTP_TARGET_NOT_PERMITTED"
  | "HTTP_TIMEOUT";

export class HttpTransportError extends Error {
  readonly code: HttpTransportErrorCode;

  constructor(code: HttpTransportErrorCode, message: string) {
    super(message);
    this.name = "HttpTransportError";
    this.code = code;
  }
}

export interface FetchHttpTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
  readonly resolveHost?: HostResolver;
}

export interface ResolvedHostAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedHostAddress[]>;

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const blockedTargets = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedTargets.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedTargets.addSubnet(network, prefix, "ipv6");
}

const defaultResolveHost: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
};

const validateMaxResponseBytes = (value: number): number => {
  if (!Number.isInteger(value) || value < 1_024 || value > 10 * 1_024 * 1_024) {
    throw new RangeError("maxResponseBytes must be between 1024 and 10485760");
  }
  return value;
};

const validateMaxRedirects = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new RangeError("maxRedirects must be between 0 and 10");
  }
  return value;
};

const normalizedHostname = (hostname: string): string =>
  hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

const assertPermittedTarget = async (url: URL, resolveHost: HostResolver): Promise<void> => {
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new HttpTransportError(
      "HTTP_TARGET_NOT_PERMITTED",
      "HTTP target is not permitted by the network policy",
    );
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port !== "" && url.port !== expectedPort) {
    throw new HttpTransportError(
      "HTTP_TARGET_NOT_PERMITTED",
      "HTTP target is not permitted by the network policy",
    );
  }
  const hostname = normalizedHostname(url.hostname).toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new HttpTransportError(
      "HTTP_TARGET_NOT_PERMITTED",
      "HTTP target is not permitted by the network policy",
    );
  }

  let addresses: readonly ResolvedHostAddress[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    throw new HttpTransportError("HTTP_REQUEST_FAILED", "HTTP target resolution failed");
  }
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        (family === 6 && address.toLowerCase().startsWith("::ffff:")) ||
        blockedTargets.check(address, family === 4 ? "ipv4" : "ipv6"),
    )
  ) {
    throw new HttpTransportError(
      "HTTP_TARGET_NOT_PERMITTED",
      "HTTP target is not permitted by the network policy",
    );
  }
};

const responseHeaders = (headers: Headers): Readonly<Record<string, string>> =>
  Object.freeze(
    Object.fromEntries([...headers.entries()].map(([name, value]) => [name.toLowerCase(), value])),
  );

const readBoundedBody = async (response: Response, maxResponseBytes: number): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      await response.body?.cancel();
      throw new HttpTransportError(
        "HTTP_RESPONSE_TOO_LARGE",
        "HTTP response exceeds the configured size limit",
      );
    }
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel();
        throw new HttpTransportError(
          "HTTP_RESPONSE_TOO_LARGE",
          "HTTP response exceeds the configured size limit",
        );
      }
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export class FetchHttpTransport implements HttpTransport {
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxResponseBytes: number;
  readonly #maxRedirects: number;
  readonly #resolveHost: HostResolver;

  constructor(options: FetchHttpTransportOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxResponseBytes = validateMaxResponseBytes(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    );
    this.#maxRedirects = validateMaxRedirects(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
    this.#resolveHost = options.resolveHost ?? defaultResolveHost;
  }

  async request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer");
    }
    let currentUrl: URL;
    try {
      currentUrl = new URL(request.url);
    } catch {
      throw new HttpTransportError(
        "HTTP_TARGET_NOT_PERMITTED",
        "HTTP target is not permitted by the network policy",
      );
    }
    const deadline = Date.now() + request.timeoutMs;

    for (let redirectCount = 0; ; redirectCount += 1) {
      await assertPermittedTarget(currentUrl, this.#resolveHost);
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1) {
        throw new HttpTransportError("HTTP_TIMEOUT", "HTTP request timed out");
      }
      let response: Response;
      try {
        response = await this.#fetch(currentUrl, {
          headers: request.headers,
          redirect: "manual",
          signal: AbortSignal.timeout(remainingMs),
        });
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw new HttpTransportError("HTTP_TIMEOUT", "HTTP request timed out");
        }
        throw new HttpTransportError("HTTP_REQUEST_FAILED", "HTTP request failed");
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return Object.freeze({
          body: await readBoundedBody(response, this.#maxResponseBytes),
          headers: responseHeaders(response.headers),
          status: response.status,
        });
      }
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (location === null) {
        return Object.freeze({
          body: "",
          headers: responseHeaders(response.headers),
          status: response.status,
        });
      }
      if (redirectCount >= this.#maxRedirects) {
        throw new HttpTransportError("HTTP_REDIRECT_LIMIT", "HTTP redirect limit exceeded");
      }
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        throw new HttpTransportError("HTTP_REQUEST_FAILED", "HTTP redirect target is invalid");
      }
    }
  }
}
