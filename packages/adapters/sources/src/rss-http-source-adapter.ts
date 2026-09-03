import { type JsonValue } from "@radar/core";
import { type SourceAdapter, type SourceFetchBatch } from "@radar/application";
import { isSourceCollectionPermitted, isoDateTime, type Source } from "@radar/core";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

import {
  FetchHttpTransport,
  HttpTransportError,
  type HttpTransport,
  type HttpTransportResponse,
} from "./http-transport.js";

export const RSS_HTTP_ADAPTER_VERSION_V1 = "rss-http/v1";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT =
  "ConstructionOpportunityRadar/0.1 (+https://github.com/BeRsErK031999/Construction_Opportunity_Radar)";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const XML_MEDIA_TYPES = new Set([
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/plain",
  "text/xml",
]);

export type RssHttpAdapterErrorCode =
  | "RSS_CONTENT_TYPE_UNSUPPORTED"
  | "RSS_CURSOR_UNSUPPORTED"
  | "RSS_FEED_INVALID"
  | "RSS_HTTP_STATUS"
  | "RSS_ITEM_INVALID"
  | "RSS_REQUEST_FAILED"
  | "RSS_SOURCE_NOT_PERMITTED"
  | "RSS_SOURCE_UNSUPPORTED";

export class RssHttpAdapterError extends Error {
  readonly attempts: number;
  readonly code: RssHttpAdapterErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | null;

  constructor(
    code: RssHttpAdapterErrorCode,
    message: string,
    options: {
      readonly attempts?: number;
      readonly retryable?: boolean;
      readonly statusCode?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "RssHttpAdapterError";
    this.attempts = options.attempts ?? 0;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? null;
  }
}

export interface RssHttpAdapterMetrics {
  readonly candidates: number;
  readonly failedFetches: number;
  readonly rateLimitWaitMs: number;
  readonly requestAttempts: number;
  readonly retries: number;
  readonly successfulFetches: number;
}

export interface RssHttpSourceAdapterOptions {
  readonly http?: HttpTransport;
  readonly maxAttempts?: number;
  readonly maxRetryDelayMs?: number;
  readonly minimumRequestIntervalMs?: number;
  readonly now?: () => Date;
  readonly retryBaseDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

export interface ParsedRssFeedV1 {
  readonly candidates: SourceFetchBatch["candidates"];
  readonly format: "ATOM" | "RSS";
}

interface SuccessfulHttpResponse {
  readonly attempts: number;
  readonly response: HttpTransportResponse;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const asArray = (value: unknown): readonly unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const textValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value.trim().length === 0 ? null : value;
  }
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  return textValue(record["#text"] ?? record["#cdata"]);
};

const fieldText = (record: UnknownRecord, names: readonly string[]): string | null => {
  for (const name of names) {
    const value = textValue(record[name]);
    if (value !== null) {
      return value;
    }
  }
  return null;
};

const httpUrl = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const atomLink = (value: unknown): string | null => {
  const links = asArray(value);
  const alternatives = links
    .map(asRecord)
    .filter((link): link is UnknownRecord => link !== null)
    .filter((link) => link["@_rel"] === undefined || link["@_rel"] === "alternate");
  for (const link of alternatives) {
    const href = typeof link["@_href"] === "string" ? link["@_href"] : textValue(link);
    const parsed = httpUrl(href);
    if (parsed !== null) {
      return parsed;
    }
  }
  return httpUrl(textValue(value));
};

const canonicalPublishedAt = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

const parsedPayload = (input: {
  readonly externalId: string;
  readonly feedFormat: ParsedRssFeedV1["format"];
  readonly feedUrl: string;
  readonly originalUrl: string;
  readonly publishedAtRaw: string | null;
  readonly rawText: string;
  readonly title: string | null;
}): JsonValue => ({
  adapterVersion: RSS_HTTP_ADAPTER_VERSION_V1,
  externalId: input.externalId,
  feedFormat: input.feedFormat,
  feedUrl: input.feedUrl,
  originalUrl: input.originalUrl,
  publishedAtRaw: input.publishedAtRaw,
  rawText: input.rawText,
  title: input.title,
});

const parseEntry = (
  value: unknown,
  index: number,
  format: ParsedRssFeedV1["format"],
  feedUrl: string,
): SourceFetchBatch["candidates"][number] => {
  const entry = asRecord(value);
  if (entry === null) {
    throw new RssHttpAdapterError(
      "RSS_ITEM_INVALID",
      `Feed item ${String(index)} has an invalid shape`,
    );
  }

  const title = fieldText(entry, ["title"]);
  const rawText = fieldText(
    entry,
    format === "RSS"
      ? ["encoded", "description", "summary", "content", "title"]
      : ["content", "summary", "title"],
  );
  const rssLink = httpUrl(fieldText(entry, ["link"]));
  const originalUrl = format === "ATOM" ? atomLink(entry.link) : rssLink;
  const identifier = fieldText(entry, format === "RSS" ? ["guid"] : ["id"]);
  const guidUrl = httpUrl(identifier);
  const resolvedUrl = originalUrl ?? guidUrl;
  if (resolvedUrl === null || rawText === null) {
    throw new RssHttpAdapterError(
      "RSS_ITEM_INVALID",
      `Feed item ${String(index)} must contain an HTTP URL and non-blank text`,
    );
  }
  const externalId = identifier ?? resolvedUrl;
  const publishedAtRaw = fieldText(
    entry,
    format === "RSS" ? ["pubDate", "published", "updated", "date"] : ["published", "updated"],
  );

  return Object.freeze({
    externalId,
    originalUrl: resolvedUrl,
    publishedAt: canonicalPublishedAt(publishedAtRaw),
    rawPayload: parsedPayload({
      externalId,
      feedFormat: format,
      feedUrl,
      originalUrl: resolvedUrl,
      publishedAtRaw,
      rawText,
      title,
    }),
    rawText,
  });
};

const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  removeNSPrefix: true,
  trimValues: false,
});

export const parseRssFeedV1 = (xml: string, feedUrl: string): ParsedRssFeedV1 => {
  try {
    SyntaxValidator.validate(xml, {
      docType: { maxEntityCount: 20, maxEntitySize: 1_000 },
      invalidCharSequence: { attrLt: true, comment: true, tagValue: true },
      multipleRoots: false,
    });
  } catch {
    throw new RssHttpAdapterError("RSS_FEED_INVALID", "RSS/Atom feed is not valid XML");
  }

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml) as unknown;
  } catch {
    throw new RssHttpAdapterError("RSS_FEED_INVALID", "RSS/Atom feed cannot be parsed");
  }
  const document = asRecord(parsed);
  const rss = asRecord(document?.rss);
  const channel = asRecord(rss?.channel);
  const atom = asRecord(document?.feed);
  let format: ParsedRssFeedV1["format"];
  let entries: readonly unknown[];
  if (channel !== null) {
    format = "RSS";
    entries = asArray(channel.item);
  } else if (atom !== null) {
    format = "ATOM";
    entries = asArray(atom.entry);
  } else {
    throw new RssHttpAdapterError(
      "RSS_FEED_INVALID",
      "XML document is neither an RSS channel nor an Atom feed",
    );
  }

  return Object.freeze({
    candidates: Object.freeze(
      entries.map((entry, index) => parseEntry(entry, index, format, feedUrl)),
    ),
    format,
  });
};

const integerOption = (value: number, name: string, minimum: number, maximum: number): number => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
};

const contentType = (headers: Readonly<Record<string, string>>): string | null => {
  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
};

const headerValue = (
  headers: Readonly<Record<string, string>>,
  searchedName: string,
): string | null =>
  Object.entries(headers).find(([name]) => name.toLowerCase() === searchedName)?.[1] ?? null;

const retryAfterMilliseconds = (
  headers: Readonly<Record<string, string>>,
  now: Date,
  maximum: number,
): number => {
  const value = headerValue(headers, "retry-after");
  if (value === null) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, maximum);
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : Math.min(Math.max(0, timestamp - now.getTime()), maximum);
};

export class RssHttpSourceAdapter implements SourceAdapter {
  readonly name = "rss-http-v1";
  readonly #http: HttpTransport;
  readonly #maxAttempts: number;
  readonly #maxRetryDelayMs: number;
  readonly #minimumRequestIntervalMs: number;
  readonly #nextRequestAtByOrigin = new Map<string, number>();
  readonly #now: () => Date;
  readonly #retryBaseDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #metrics = {
    candidates: 0,
    failedFetches: 0,
    rateLimitWaitMs: 0,
    requestAttempts: 0,
    retries: 0,
    successfulFetches: 0,
  };

  constructor(options: RssHttpSourceAdapterOptions = {}) {
    this.#http = options.http ?? new FetchHttpTransport();
    this.#maxAttempts = integerOption(
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      "maxAttempts",
      1,
      5,
    );
    this.#maxRetryDelayMs = integerOption(
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      "maxRetryDelayMs",
      0,
      60_000,
    );
    this.#minimumRequestIntervalMs = integerOption(
      options.minimumRequestIntervalMs ?? DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
      "minimumRequestIntervalMs",
      0,
      60_000,
    );
    this.#now = options.now ?? (() => new Date());
    this.#retryBaseDelayMs = integerOption(
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      "retryBaseDelayMs",
      0,
      60_000,
    );
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#timeoutMs = integerOption(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      100,
      120_000,
    );
    this.#userAgent = (options.userAgent ?? DEFAULT_USER_AGENT).trim();
    if (this.#userAgent.length < 3 || this.#userAgent.length > 500) {
      throw new RangeError("userAgent must contain between 3 and 500 characters");
    }
  }

  supports(source: Source): boolean {
    return source.type === "RSS" && source.collectionPolicy.parserKind === "RSS";
  }

  metrics(): RssHttpAdapterMetrics {
    return Object.freeze({ ...this.#metrics });
  }

  async fetch({
    cursor,
    source,
  }: Parameters<SourceAdapter["fetch"]>[0]): Promise<SourceFetchBatch> {
    if (!this.supports(source)) {
      throw new RssHttpAdapterError(
        "RSS_SOURCE_UNSUPPORTED",
        `Source ${source.id} is not configured for RSS collection`,
      );
    }
    if (!isSourceCollectionPermitted(source)) {
      throw new RssHttpAdapterError(
        "RSS_SOURCE_NOT_PERMITTED",
        `Collection is not permitted for source ${source.id}`,
      );
    }
    if (cursor !== null) {
      throw new RssHttpAdapterError(
        "RSS_CURSOR_UNSUPPORTED",
        "RSS adapter does not support pagination cursors",
      );
    }

    try {
      const request = await this.#requestWithRetry(source);
      const { response } = request;
      const mediaType = contentType(response.headers);
      if (mediaType !== null && !XML_MEDIA_TYPES.has(mediaType)) {
        throw new RssHttpAdapterError(
          "RSS_CONTENT_TYPE_UNSUPPORTED",
          `RSS endpoint returned unsupported media type ${mediaType}`,
          { attempts: request.attempts, statusCode: response.status },
        );
      }
      const parsed = parseRssFeedV1(response.body, source.url);
      const fetchedAt = isoDateTime(this.#now().toISOString(), "fetchedAt");
      this.#metrics.candidates += parsed.candidates.length;
      this.#metrics.successfulFetches += 1;
      return Object.freeze({
        adapter: this.name,
        candidates: parsed.candidates,
        fetchedAt,
        nextCursor: null,
        sourceId: source.id,
        version: RSS_HTTP_ADAPTER_VERSION_V1,
      });
    } catch (error) {
      this.#metrics.failedFetches += 1;
      if (error instanceof RssHttpAdapterError) {
        throw error;
      }
      throw new RssHttpAdapterError(
        "RSS_REQUEST_FAILED",
        `RSS request failed for source ${source.id}`,
        { retryable: true },
      );
    }
  }

  async #requestWithRetry(source: Source): Promise<SuccessfulHttpResponse> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      await this.#waitForRateLimit(source.url);
      this.#metrics.requestAttempts += 1;
      let response: HttpTransportResponse;
      try {
        response = await this.#http.request({
          headers: {
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
            "User-Agent": this.#userAgent,
          },
          timeoutMs: this.#timeoutMs,
          url: source.url,
        });
      } catch (error) {
        if (error instanceof HttpTransportError && error.code === "HTTP_RESPONSE_TOO_LARGE") {
          throw new RssHttpAdapterError(
            "RSS_REQUEST_FAILED",
            "RSS response exceeds the configured size limit",
            { attempts: attempt, retryable: false },
          );
        }
        if (
          error instanceof HttpTransportError &&
          (error.code === "HTTP_TARGET_NOT_PERMITTED" || error.code === "HTTP_REDIRECT_LIMIT")
        ) {
          throw new RssHttpAdapterError(
            "RSS_REQUEST_FAILED",
            "RSS target is not permitted by the network policy",
            { attempts: attempt, retryable: false },
          );
        }
        if (attempt < this.#maxAttempts) {
          await this.#retryDelay(attempt, 0);
          continue;
        }
        const timeout = error instanceof HttpTransportError && error.code === "HTTP_TIMEOUT";
        throw new RssHttpAdapterError(
          "RSS_REQUEST_FAILED",
          timeout
            ? `RSS request timed out after ${String(attempt)} attempts`
            : `RSS request failed after ${String(attempt)} attempts`,
          { attempts: attempt, retryable: true },
        );
      }

      if (response.status >= 200 && response.status < 300) {
        return Object.freeze({ attempts: attempt, response });
      }
      const retryable = RETRYABLE_STATUSES.has(response.status);
      if (retryable && attempt < this.#maxAttempts) {
        await this.#retryDelay(
          attempt,
          retryAfterMilliseconds(response.headers, this.#now(), this.#maxRetryDelayMs),
        );
        continue;
      }
      throw new RssHttpAdapterError(
        "RSS_HTTP_STATUS",
        `RSS endpoint returned HTTP ${String(response.status)} after ${String(attempt)} attempts`,
        {
          attempts: attempt,
          retryable,
          statusCode: response.status,
        },
      );
    }
    throw new RssHttpAdapterError("RSS_REQUEST_FAILED", "RSS retry budget was exhausted", {
      attempts: this.#maxAttempts,
      retryable: true,
    });
  }

  async #retryDelay(attempt: number, retryAfterMs: number): Promise<void> {
    this.#metrics.retries += 1;
    const exponentialDelay = Math.min(
      this.#retryBaseDelayMs * 2 ** (attempt - 1),
      this.#maxRetryDelayMs,
    );
    await this.#sleep(Math.max(exponentialDelay, retryAfterMs));
  }

  async #waitForRateLimit(url: string): Promise<void> {
    const origin = new URL(url).origin;
    const now = this.#now().getTime();
    const nextRequestAt = this.#nextRequestAtByOrigin.get(origin) ?? now;
    const waitMs = Math.max(0, nextRequestAt - now);
    if (waitMs > 0) {
      this.#metrics.rateLimitWaitMs += waitMs;
      await this.#sleep(waitMs);
    }
    const afterWait = this.#now().getTime();
    this.#nextRequestAtByOrigin.set(
      origin,
      Math.max(nextRequestAt, afterWait) + this.#minimumRequestIntervalMs,
    );
  }
}
