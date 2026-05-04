import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRobots } from "../src/fetcher.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: string | null = null,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

function stubFetch(...responses: Array<Response | Error>): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r;
    }),
  );
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

describe("fetchRobots – URL construction", () => {
  it("always fetches /robots.txt regardless of the input path", async () => {
    stubFetch(makeResponse(200, "User-agent: *\nDisallow: /\n"));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await fetchRobots("https://example.com/some/deep/path");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/robots.txt");
  });

  it("works with a bare origin", async () => {
    stubFetch(makeResponse(200, "User-agent: *\nDisallow: /\n"));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await fetchRobots("https://example.com");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/robots.txt");
  });
});

// ---------------------------------------------------------------------------
// HTTP status handling
// ---------------------------------------------------------------------------

describe("fetchRobots – HTTP status", () => {
  it("200 OK returns a parsed RobotsFile", async () => {
    stubFetch(makeResponse(200, "User-agent: *\nDisallow: /private\n"));
    const f = await fetchRobots("https://example.com");
    expect(f.isAllowed("anybot", "https://example.com/private/x")).toBe(false);
    expect(f.isAllowed("anybot", "https://example.com/public")).toBe(true);
  });

  it("404 returns a permissive RobotsFile", async () => {
    stubFetch(makeResponse(404));
    const f = await fetchRobots("https://example.com");
    expect(f.isPermissive).toBe(true);
    expect(f.isAllowed("anybot", "https://example.com/anything")).toBe(true);
  });

  it("403 returns a permissive RobotsFile", async () => {
    stubFetch(makeResponse(403));
    const f = await fetchRobots("https://example.com");
    expect(f.isPermissive).toBe(true);
  });

  it("499 returns a permissive RobotsFile", async () => {
    stubFetch(makeResponse(499));
    const f = await fetchRobots("https://example.com");
    expect(f.isPermissive).toBe(true);
  });

  it("500 returns a restrictive RobotsFile", async () => {
    stubFetch(makeResponse(500));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
    expect(f.isAllowed("anybot", "https://example.com/anything")).toBe(false);
  });

  it("503 returns a restrictive RobotsFile", async () => {
    stubFetch(makeResponse(503));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });

  it("1xx returns a restrictive RobotsFile", async () => {
    // new Response() rejects status < 200, so use a fake object
    const fake = { status: 100, headers: new Headers(), body: null } as unknown as Response;
    stubFetch(fake);
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe("fetchRobots – network errors", () => {
  it("network error returns a restrictive RobotsFile", async () => {
    stubFetch(new TypeError("fetch failed"));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });

  it("AbortError returns a restrictive RobotsFile", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

describe("fetchRobots – redirects", () => {
  it("follows up to maxRedirects (default 5) redirects", async () => {
    stubFetch(
      makeResponse(301, null, { Location: "https://example.com/robots.txt" }),
      makeResponse(301, null, { Location: "https://example.com/robots.txt" }),
      makeResponse(301, null, { Location: "https://example.com/robots.txt" }),
      makeResponse(200, "User-agent: *\nDisallow: /\n"),
    );
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(false);
    expect(f.isAllowed("anybot", "https://example.com/page")).toBe(false);
  });

  it("returns restrictive when redirect count exceeds maxRedirects", async () => {
    const redirect = makeResponse(301, null, { Location: "https://example.com/robots.txt" });
    stubFetch(redirect, redirect, redirect, redirect, redirect, redirect);
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });

  it("returns restrictive when Location header is missing", async () => {
    stubFetch(makeResponse(301));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });

  it("returns restrictive when Location header contains an invalid URL", async () => {
    stubFetch(makeResponse(301, null, { Location: "http:// spaces.com" }));
    const f = await fetchRobots("https://example.com");
    expect(f.isRestrictive).toBe(true);
  });

  it("respects custom maxRedirects option", async () => {
    const redirect = makeResponse(301, null, { Location: "https://example.com/robots.txt" });
    stubFetch(redirect, redirect, redirect);
    const f = await fetchRobots("https://example.com", { maxRedirects: 2 });
    expect(f.isRestrictive).toBe(true);
  });

  it("maxRedirects: 0 disables redirect following", async () => {
    stubFetch(makeResponse(301, null, { Location: "https://example.com/robots.txt" }));
    const f = await fetchRobots("https://example.com", { maxRedirects: 0 });
    expect(f.isRestrictive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Body reading and size limit
// ---------------------------------------------------------------------------

describe("fetchRobots – body handling", () => {
  it("handles a null body (no content)", async () => {
    stubFetch(makeResponse(200, null));
    const f = await fetchRobots("https://example.com");
    expect(f.groups).toHaveLength(0);
  });

  it("handles an empty body", async () => {
    stubFetch(makeResponse(200, ""));
    const f = await fetchRobots("https://example.com");
    expect(f.groups).toHaveLength(0);
  });

  it("truncates body exceeding maxSizeBytes", async () => {
    const large = "User-agent: *\nDisallow: /\n" + "x".repeat(200);
    stubFetch(makeResponse(200, large));
    const f = await fetchRobots("https://example.com", { maxSizeBytes: 30 });
    expect(f).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe("fetchRobots – options", () => {
  it("uses default User-Agent when none provided", async () => {
    stubFetch(makeResponse(200, ""));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await fetchRobots("https://example.com");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("robots-txt-parser/1.0");
  });

  it("uses custom User-Agent when provided", async () => {
    stubFetch(makeResponse(200, ""));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await fetchRobots("https://example.com", { userAgent: "my-bot/1.0" });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("my-bot/1.0");
  });

  it("uses all custom options when provided", async () => {
    const redirect = makeResponse(301, null, { Location: "https://example.com/robots.txt" });
    stubFetch(redirect, makeResponse(200, ""));
    const f = await fetchRobots("https://example.com", {
      userAgent: "custom/1",
      maxRedirects: 1,
      timeoutMs: 5000,
      maxSizeBytes: 1024,
    });
    expect(f).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

describe("fetchRobots – meta", () => {
  it("sets meta on a 200 response", async () => {
    stubFetch(makeResponse(200, "", { "content-type": "text/plain" }));
    const f = await fetchRobots("https://example.com");
    expect(f.meta).toEqual({
      url: "https://example.com/robots.txt",
      finalUrl: "https://example.com/robots.txt",
      httpStatus: 200,
      contentType: "text/plain",
      redirects: 0,
    });
  });

  it("sets meta on a 404 (permissive) response", async () => {
    stubFetch(makeResponse(404));
    const f = await fetchRobots("https://example.com");
    expect(f.meta?.httpStatus).toBe(404);
    expect(f.meta?.redirects).toBe(0);
  });

  it("sets meta on a 500 (restrictive) response", async () => {
    stubFetch(makeResponse(500));
    const f = await fetchRobots("https://example.com");
    expect(f.meta?.httpStatus).toBe(500);
  });

  it("httpStatus is null on network error", async () => {
    stubFetch(new TypeError("fetch failed"));
    const f = await fetchRobots("https://example.com");
    expect(f.meta?.httpStatus).toBe(null);
  });

  it("counts redirects and reports finalUrl", async () => {
    stubFetch(
      makeResponse(301, null, { Location: "https://example.com/r1" }),
      makeResponse(301, null, { Location: "https://example.com/r2" }),
      makeResponse(200, ""),
    );
    const f = await fetchRobots("https://example.com");
    expect(f.meta?.redirects).toBe(2);
    expect(f.meta?.finalUrl).toBe("https://example.com/r2");
    expect(f.meta?.url).toBe("https://example.com/robots.txt");
  });

  it("parse() produces a RobotsFile with meta = null", async () => {
    const { parse } = await import("../src/parser.js");
    const f = parse("User-agent: *\nDisallow: /\n");
    expect(f.meta).toBe(null);
  });
});
