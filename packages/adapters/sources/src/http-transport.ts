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
  "HTTP_REQUEST_FAILED" | "HTTP_RESPONSE_TOO_LARGE" | "HTTP_TIMEOUT";

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
}

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;

const validateMaxResponseBytes = (value: number): number => {
  if (!Number.isInteger(value) || value < 1_024 || value > 10 * 1_024 * 1_024) {
    throw new RangeError("maxResponseBytes must be between 1024 and 10485760");
  }
  return value;
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

  constructor(options: FetchHttpTransportOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxResponseBytes = validateMaxResponseBytes(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    );
  }

  async request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer");
    }
    let response: Response;
    try {
      response = await this.#fetch(request.url, {
        headers: request.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(request.timeoutMs),
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

    return Object.freeze({
      body: await readBoundedBody(response, this.#maxResponseBytes),
      headers: responseHeaders(response.headers),
      status: response.status,
    });
  }
}
