import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("integration – longest-match fixture (RFC §5.2 pattern)", () => {
  const f = parse(fixture("longest-match.txt"));

  it("allows /example/page/ (allow rule is a prefix match)", () => {
    expect(f.isAllowed("foobot", "https://example.com/example/page/")).toBe(true);
    expect(f.isAllowed("foobot", "https://example.com/example/page/index.html")).toBe(true);
  });

  it("disallows /example/page/disallowed.gif (longer disallow wins)", () => {
    expect(f.isAllowed("foobot", "https://example.com/example/page/disallowed.gif")).toBe(false);
  });
});

describe("integration – wildcards fixture", () => {
  const f = parse(fixture("wildcards.txt"));

  it("disallows .gif files via /*.gif$ anchor", () => {
    expect(f.isAllowed("*", "https://example.com/photo.gif")).toBe(false);
    expect(f.isAllowed("*", "https://example.com/sub/photo.gif")).toBe(false);
  });

  it("allows .gif with query string ($ anchors to exact end)", () => {
    expect(f.isAllowed("*", "https://example.com/photo.gif?size=large")).toBe(true);
  });

  it("disallows /tmp/ paths", () => {
    expect(f.isAllowed("*", "https://example.com/tmp/file.txt")).toBe(false);
  });

  it("allows /tmp/public/ (longer allow beats shorter disallow)", () => {
    expect(f.isAllowed("*", "https://example.com/tmp/public/file.txt")).toBe(true);
  });

  it("allows /images/*.jpg paths", () => {
    expect(f.isAllowed("*", "https://example.com/images/photo.jpg")).toBe(true);
    expect(f.isAllowed("*", "https://example.com/images/deep/photo.jpg")).toBe(true);
  });
});

describe("integration – percent-encoded fixture", () => {
  const f = parse(fixture("percent-encoded.txt"));

  it("disallows a path with a literal slash encoded as %2F", () => {
    // Pattern /foo%2Fbar matches the path /foo%2Fbar (kept encoded)
    expect(f.isAllowed("*", "https://example.com/foo%2Fbar")).toBe(false);
  });

  it("allows /foo/bar (literal slash, different path)", () => {
    // Allow rule /foo/bar wins; /foo%2Fbar is a different path
    expect(f.isAllowed("*", "https://example.com/foo/bar")).toBe(true);
  });
});

describe("integration – extensions fixture", () => {
  const f = parse(fixture("extensions.txt"));

  it("collects multiple Sitemap entries", () => {
    expect(f.getSitemaps()).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/news.xml",
    ]);
  });

  it("collects LLMS extension value", () => {
    expect(f.getExtensionValues("llms")).toEqual(["https://example.com/llms.txt"]);
  });

  it("collects multi-value custom extension", () => {
    expect(f.getExtensionValues("x-custom")).toEqual(["hello", "world"]);
  });

  it("the wildcard group disallows everything", () => {
    expect(f.isAllowed("anybot", "https://example.com/page")).toBe(false);
  });
});

describe("integration – /robots.txt is always allowed", () => {
  it("even when Disallow: / is set", () => {
    const f = parse("User-agent: *\nDisallow: /\n");
    expect(f.isAllowed("anybot", "https://example.com/robots.txt")).toBe(true);
  });
});

describe("integration – wildcard user-agent fallback", () => {
  it("specific agent is not blocked by the wildcard group", () => {
    const content = "User-agent: *\nDisallow: /\n\nUser-agent: googlebot\nAllow: /\n";
    const f = parse(content);
    expect(f.isAllowed("googlebot", "https://example.com/page")).toBe(true);
    expect(f.isAllowed("bingbot", "https://example.com/page")).toBe(false);
  });
});
