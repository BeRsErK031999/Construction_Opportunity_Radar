import { describe, expect, it } from "vitest";

import { FetchHttpTransport } from "../src/index.js";

describe("FetchHttpTransport", () => {
  it("normalizes response headers and decodes a bounded body", async () => {
    const calls: { readonly init: RequestInit | undefined; readonly url: string }[] = [];
    const transport = new FetchHttpTransport({
      fetch: (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ init, url });
        return Promise.resolve(
          new Response("<rss></rss>", {
            headers: { "Content-Type": "application/rss+xml" },
            status: 200,
          }),
        );
      },
      maxResponseBytes: 1_024,
    });

    const result = await transport.request({
      headers: { "User-Agent": "RadarCollector/1.0" },
      timeoutMs: 1_000,
      url: "https://approved-source.example/feed.xml",
    });

    expect(result).toEqual({
      body: "<rss></rss>",
      headers: { "content-type": "application/rss+xml" },
      status: 200,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://approved-source.example/feed.xml" });
    expect(calls[0]?.init).toMatchObject({ headers: { "User-Agent": "RadarCollector/1.0" } });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a response larger than the configured byte bound", async () => {
    const transport = new FetchHttpTransport({
      fetch: () => Promise.resolve(new Response("x".repeat(1_025))),
      maxResponseBytes: 1_024,
    });

    await expect(
      transport.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_RESPONSE_TOO_LARGE" });
  });

  it("maps timeout and network failures to safe transport errors", async () => {
    const timeout = new FetchHttpTransport({
      fetch: () => Promise.reject(new DOMException("private timeout detail", "TimeoutError")),
    });
    await expect(
      timeout.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_TIMEOUT", message: "HTTP request timed out" });

    const network = new FetchHttpTransport({
      fetch: () => Promise.reject(new Error("private network detail")),
    });
    await expect(
      network.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED", message: "HTTP request failed" });
  });
});
