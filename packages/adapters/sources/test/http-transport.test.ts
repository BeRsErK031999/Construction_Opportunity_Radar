import { describe, expect, it } from "vitest";

import { FetchHttpTransport } from "../src/index.js";

const publicResolver = () => Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]);

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
      resolveHost: publicResolver,
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
      resolveHost: publicResolver,
    });

    await expect(
      transport.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_RESPONSE_TOO_LARGE" });
  });

  it("maps timeout and network failures to safe transport errors", async () => {
    const timeout = new FetchHttpTransport({
      fetch: () => Promise.reject(new DOMException("private timeout detail", "TimeoutError")),
      resolveHost: publicResolver,
    });
    await expect(
      timeout.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_TIMEOUT", message: "HTTP request timed out" });

    const network = new FetchHttpTransport({
      fetch: () => Promise.reject(new Error("private network detail")),
      resolveHost: publicResolver,
    });
    await expect(
      network.request({ headers: {}, timeoutMs: 1_000, url: "https://approved.example/feed" }),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED", message: "HTTP request failed" });
  });

  it("rejects credentials, custom ports, and private network targets before fetch", async () => {
    let fetchCalls = 0;
    const transport = new FetchHttpTransport({
      fetch: () => {
        fetchCalls += 1;
        return Promise.resolve(new Response("unexpected"));
      },
      resolveHost: (hostname) => {
        if (hostname === "::1") {
          return Promise.resolve([{ address: hostname, family: 6 }]);
        }
        return Promise.resolve([
          {
            address:
              hostname === "127.0.0.1"
                ? hostname
                : hostname === "private.example"
                  ? "10.0.0.4"
                  : "93.184.216.34",
            family: 4,
          },
        ]);
      },
    });

    for (const url of [
      "http://127.0.0.1/feed",
      "http://[::1]/feed",
      "https://private.example/feed",
      "https://user:password@approved.example/feed",
      "https://approved.example:8443/feed",
    ]) {
      await expect(transport.request({ headers: {}, timeoutMs: 1_000, url })).rejects.toMatchObject(
        {
          code: "HTTP_TARGET_NOT_PERMITTED",
          message: "HTTP target is not permitted by the network policy",
        },
      );
    }
    expect(fetchCalls).toBe(0);
  });

  it("revalidates every redirect target and bounds redirect chains", async () => {
    const privateRedirect = new FetchHttpTransport({
      fetch: () =>
        Promise.resolve(
          new Response(null, {
            headers: { location: "http://169.254.169.254/latest/meta-data" },
            status: 302,
          }),
        ),
      resolveHost: (hostname) =>
        Promise.resolve([
          { address: hostname === "169.254.169.254" ? hostname : "93.184.216.34", family: 4 },
        ]),
    });
    await expect(
      privateRedirect.request({
        headers: {},
        timeoutMs: 1_000,
        url: "https://approved.example/feed",
      }),
    ).rejects.toMatchObject({ code: "HTTP_TARGET_NOT_PERMITTED" });

    const noRedirects = new FetchHttpTransport({
      fetch: () =>
        Promise.resolve(new Response(null, { headers: { location: "/next" }, status: 302 })),
      maxRedirects: 0,
      resolveHost: publicResolver,
    });
    await expect(
      noRedirects.request({
        headers: {},
        timeoutMs: 1_000,
        url: "https://approved.example/feed",
      }),
    ).rejects.toMatchObject({ code: "HTTP_REDIRECT_LIMIT" });
  });
});
