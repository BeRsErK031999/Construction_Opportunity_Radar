import { createHash } from "node:crypto";

import {
  type CorrelationId,
  type NormalizedItemId,
  type RawItemId,
} from "../shared/identifiers.js";
import {
  isoDateTime,
  nonEmptyString,
  version,
  type IsoDateTime,
  type Version,
} from "../shared/primitives.js";
import { createNormalizedItem, type NormalizedItem } from "./normalized-item.js";
import { type RawItem } from "../ingestion/raw-item.js";

export const NORMALIZER_VERSION_V1 = "normalizer-v1";

export const NORMALIZATION_REJECTION_CODES = ["EMPTY_NORMALIZED_TEXT"] as const;
export type NormalizationRejectionCode = (typeof NORMALIZATION_REJECTION_CODES)[number];

export interface NormalizationSucceeded {
  readonly item: NormalizedItem;
  readonly status: "SUCCEEDED";
}

export interface NormalizationRejected {
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly detail: string;
  readonly normalizerVersion: Version;
  readonly rawItemId: RawItemId;
  readonly rejectionCode: NormalizationRejectionCode;
  readonly status: "REJECTED";
}

export type NormalizationOutcome = NormalizationRejected | NormalizationSucceeded;

export interface NormalizeRawItemV1Input {
  readonly createdAt: string;
  readonly id: NormalizedItemId;
  readonly rawItem: RawItem;
}

export interface CreateNormalizationRejectedInput {
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly detail: string;
  readonly normalizerVersion: string;
  readonly rawItemId: RawItemId;
  readonly rejectionCode: NormalizationRejectionCode;
}

const BLOCK_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
];

const BOILERPLATE_LINES = new Set([
  "все права защищены",
  "поделиться",
  "подписаться на новости",
  "политика конфиденциальности",
  "принять все cookie",
]);

const TRACKING_PARAMETERS = new Set(["_openstat", "fbclid", "gclid", "yclid", "ysclid"]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  laquo: "«",
  ldquo: "“",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
});

const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/giu,
    (
      entity,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      name: string | undefined,
    ) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(
          decimal ?? hexadecimal ?? "",
          decimal === undefined ? 16 : 10,
        );
        if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
          return String.fromCodePoint(codePoint);
        }
        return entity;
      }
      return name === undefined ? entity : (NAMED_ENTITIES[name.toLowerCase()] ?? entity);
    },
  );

const extractHtmlTitle = (value: string): string | null => {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(value);
  return match?.[1] ?? null;
};

const payloadTitle = (rawItem: RawItem): string | null => {
  const payload = rawItem.rawPayload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const title: unknown = "title" in payload ? payload.title : undefined;
  return typeof title === "string" ? title : null;
};

const markupToText = (value: string): string => {
  const withoutDiscardedBlocks = value
    .replace(/<!--([\s\S]*?)-->/gu, "\n")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "\n")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, "\n");
  const withBlockBreaks = withoutDiscardedBlocks.replace(
    new RegExp(`</?(?:${BLOCK_TAGS.join("|")})\\b[^>]*>`, "giu"),
    "\n",
  );
  return decodeHtmlEntities(withBlockBreaks.replace(/<[^>]+>/gu, " "));
};

const normalizeLines = (value: string): string => {
  const normalizedLines: string[] = [];
  let previousComparable: string | null = null;

  for (const rawLine of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.replace(/[\t\f\v\u00a0 ]+/gu, " ").trim();
    if (line.length === 0) {
      if (normalizedLines.at(-1) !== "") {
        normalizedLines.push("");
      }
      continue;
    }

    const comparable = line.toLocaleLowerCase("ru");
    if (
      BOILERPLATE_LINES.has(comparable) ||
      comparable.startsWith("мы используем файлы cookie") ||
      comparable === previousComparable
    ) {
      continue;
    }

    normalizedLines.push(line);
    previousComparable = comparable;
  }

  while (normalizedLines[0] === "") {
    normalizedLines.shift();
  }
  while (normalizedLines.at(-1) === "") {
    normalizedLines.pop();
  }
  return normalizedLines.join("\n");
};

const normalizeTitle = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  const title = normalizeLines(markupToText(value)).replace(/\n+/gu, " ").trim();
  return title.length === 0 ? null : title.slice(0, 1_000);
};

export const canonicalizeUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = "";
  url.username = "";
  url.password = "";

  const parameters = [...url.searchParams.entries()]
    .filter(([name]) => {
      const lowerName = name.toLowerCase();
      return !lowerName.startsWith("utm_") && !TRACKING_PARAMETERS.has(lowerName);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = leftName.localeCompare(rightName, "en");
      return nameOrder === 0 ? leftValue.localeCompare(rightValue, "en") : nameOrder;
    });
  url.search = "";
  for (const [name, parameterValue] of parameters) {
    url.searchParams.append(name, parameterValue);
  }

  url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/gu, "");
  }
  return url.toString();
};

export const detectLanguageV1 = (text: string): string => {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (cyrillic === 0 && latin === 0) {
    return "und";
  }
  return cyrillic >= latin ? "ru" : "en";
};

export const createNormalizationRejected = (
  input: CreateNormalizationRejectedInput,
): NormalizationRejected =>
  Object.freeze({
    correlationId: input.correlationId,
    createdAt: isoDateTime(input.createdAt, "createdAt"),
    detail: nonEmptyString(input.detail, "detail", 2_000),
    normalizerVersion: version(input.normalizerVersion, "normalizerVersion"),
    rawItemId: input.rawItemId,
    rejectionCode: input.rejectionCode,
    status: "REJECTED",
  });

export const normalizeRawItemV1 = (input: NormalizeRawItemV1Input): NormalizationOutcome => {
  const { createdAt, id, rawItem } = input;
  const htmlTitle = extractHtmlTitle(rawItem.rawText);
  const text = normalizeLines(markupToText(rawItem.rawText));
  if (text.length === 0) {
    return createNormalizationRejected({
      correlationId: rawItem.correlationId,
      createdAt,
      detail: "No meaningful text remained after markup and boilerplate cleanup",
      normalizerVersion: NORMALIZER_VERSION_V1,
      rawItemId: rawItem.id,
      rejectionCode: "EMPTY_NORMALIZED_TEXT",
    });
  }

  const normalizedHash = createHash("sha256").update(text, "utf8").digest("hex");
  return Object.freeze({
    item: createNormalizedItem({
      canonicalUrl: canonicalizeUrl(rawItem.originalUrl),
      correlationId: rawItem.correlationId,
      createdAt,
      id,
      language: detectLanguageV1(text),
      normalizedHash,
      normalizerVersion: NORMALIZER_VERSION_V1,
      publishedAt: rawItem.publishedAt,
      rawItemId: rawItem.id,
      text,
      title: normalizeTitle(payloadTitle(rawItem) ?? htmlTitle),
    }),
    status: "SUCCEEDED",
  });
};

export const normalizationOutcomeRawItemId = (outcome: NormalizationOutcome): RawItemId =>
  outcome.status === "SUCCEEDED" ? outcome.item.rawItemId : outcome.rawItemId;

export const normalizationOutcomeVersion = (outcome: NormalizationOutcome): Version =>
  outcome.status === "SUCCEEDED" ? outcome.item.normalizerVersion : outcome.normalizerVersion;
