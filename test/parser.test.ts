import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, parseContent } from "../src/parser.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parseContent – size limit", () => {
  it("returns content unchanged when under 500 KiB", () => {
    const data = parseContent("User-agent: *\nDisallow: /\n");
    expect(data.groups).toHaveLength(1);
  });

  it("truncates content that exceeds 500 KiB", () => {
    // Build > 500 KiB of content that still starts with a valid group
    const line = "User-agent: *\nDisallow: /\n";
    const repeated = line.repeat(Math.ceil((500 * 1024) / line.length) + 10);
    // Should not throw and must return a result
    const data = parseContent(repeated);
    expect(data.groups.length).toBeGreaterThan(0);
  });
});

describe("parseContent – line endings", () => {
  it("handles LF line endings", () => {
    const data = parseContent("User-agent: *\nDisallow: /\n");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/");
  });

  it("handles CRLF line endings", () => {
    const data = parseContent("User-agent: *\r\nDisallow: /\r\n");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/");
  });

  it("handles CR-only line endings", () => {
    const data = parseContent("User-agent: *\rDisallow: /\r");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/");
  });

  it("handles mixed line endings", () => {
    const data = parseContent("User-agent: *\nDisallow: /foo\r\nDisallow: /bar\r");
    expect(data.groups[0]?.rules).toHaveLength(2);
  });
});

describe("parseContent – comment stripping", () => {
  it("strips a leading comment line", () => {
    const data = parseContent("# This is a comment\nUser-agent: *\nDisallow: /\n");
    expect(data.groups).toHaveLength(1);
  });

  it("strips inline comments", () => {
    const data = parseContent("User-agent: * # inline comment\nDisallow: / # another\n");
    expect(data.groups[0]?.userAgents).toEqual(["*"]);
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/");
  });

  it("does NOT treat %23 as a comment", () => {
    const data = parseContent("User-agent: *\nDisallow: /foo%23bar\n");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/foo%23bar");
  });

  it("strips a # that follows an invalid % sequence", () => {
    const data = parseContent("User-agent: *\nDisallow: /foo%GG#comment\n");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/foo%GG");
  });

  it("handles % at end of value before a comment", () => {
    // % right before # — not a valid %XX, so # is a comment
    const data = parseContent("User-agent: *\nDisallow: /foo%#comment\n");
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/foo%");
  });
});

describe("parseContent – tokenizer", () => {
  it("skips lines with no colon", () => {
    const data = parseContent("User-agent: *\nno colon here\nDisallow: /\n");
    expect(data.groups[0]?.rules).toHaveLength(1);
  });

  it("recognizes user-agent (case-insensitive key)", () => {
    const data = parseContent("USER-AGENT: *\nDISALLOW: /\n");
    expect(data.groups[0]?.userAgents).toEqual(["*"]);
  });

  it("recognizes allow key", () => {
    const data = parseContent("User-agent: *\nAllow: /public\n");
    expect(data.groups[0]?.rules[0]?.type).toBe("allow");
  });

  it("recognizes disallow key", () => {
    const data = parseContent("User-agent: *\nDisallow: /private\n");
    expect(data.groups[0]?.rules[0]?.type).toBe("disallow");
  });

  it("recognizes sitemap key", () => {
    const data = parseContent("Sitemap: https://example.com/sitemap.xml\n");
    expect(data.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("treats unknown keys as extensions", () => {
    const data = parseContent("User-agent: *\nX-Foo: bar\n");
    expect(data.extensions.get("x-foo")).toEqual(["bar"]);
  });
});

describe("parseContent – state machine", () => {
  it("discards allow/disallow rules before the first user-agent", () => {
    const data = parseContent("Disallow: /secret\nAllow: /\nUser-agent: *\nDisallow: /\n");
    expect(data.groups[0]?.rules).toHaveLength(1);
    expect(data.groups[0]?.rules[0]?.pattern).toBe("/");
  });

  it("skips empty user-agent values", () => {
    const data = parseContent("User-agent:\nDisallow: /\n");
    expect(data.groups).toHaveLength(0);
  });

  it("groups multiple user-agents together", () => {
    const data = parseContent("User-agent: googlebot\nUser-agent: bingbot\nDisallow: /\n");
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.userAgents).toEqual(["googlebot", "bingbot"]);
  });

  it("starts a new group when a user-agent follows rules", () => {
    const content = "User-agent: *\nDisallow: /a\n\nUser-agent: googlebot\nDisallow: /b\n";
    const data = parseContent(content);
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0]?.userAgents).toEqual(["*"]);
    expect(data.groups[1]?.userAgents).toEqual(["googlebot"]);
  });

  it("skips empty Disallow values", () => {
    const data = parseContent("User-agent: *\nDisallow:\n");
    expect(data.groups[0]?.rules).toHaveLength(0);
  });

  it("skips empty Allow values", () => {
    const data = parseContent("User-agent: *\nAllow:\n");
    expect(data.groups[0]?.rules).toHaveLength(0);
  });

  it("Sitemap does NOT terminate the current group", () => {
    const data = parseContent(
      "User-agent: *\nDisallow: /a\nSitemap: https://x.com/s.xml\nDisallow: /b\n",
    );
    expect(data.groups[0]?.rules).toHaveLength(2);
    expect(data.sitemaps).toHaveLength(1);
  });

  it("extension lines do NOT terminate the current group", () => {
    const data = parseContent("User-agent: *\nDisallow: /a\nX-Foo: bar\nDisallow: /b\n");
    expect(data.groups[0]?.rules).toHaveLength(2);
  });

  it("skips Sitemap with empty value", () => {
    const data = parseContent("Sitemap:\nUser-agent: *\nDisallow: /\n");
    expect(data.sitemaps).toHaveLength(0);
  });

  it("collects multiple Sitemap entries", () => {
    const data = parseContent("Sitemap: https://a.com/s1.xml\nSitemap: https://a.com/s2.xml\n");
    expect(data.sitemaps).toHaveLength(2);
  });

  it("accumulates extension values for the same key", () => {
    const data = parseContent("User-agent: *\nX-Foo: v1\nX-Foo: v2\n");
    expect(data.extensions.get("x-foo")).toEqual(["v1", "v2"]);
  });

  it("skips extension with empty value", () => {
    const data = parseContent("User-agent: *\nX-Foo:\n");
    expect(data.extensions.has("x-foo")).toBe(false);
  });

  it("handles an empty file", () => {
    const data = parseContent("");
    expect(data.groups).toHaveLength(0);
    expect(data.sitemaps).toHaveLength(0);
  });

  it("handles file with only sitemaps (no user-agents) – empty flush path", () => {
    const data = parseContent("Sitemap: https://example.com/s.xml\n");
    expect(data.groups).toHaveLength(0);
    expect(data.sitemaps).toHaveLength(1);
  });

  it("normalizes user-agent values to lowercase", () => {
    const data = parseContent("User-agent: Googlebot\nDisallow: /\n");
    expect(data.groups[0]?.userAgents).toEqual(["googlebot"]);
  });

  it("sets isAllRobotsDenied and isPermissive to false", () => {
    const data = parseContent("User-agent: *\nDisallow: /\n");
    expect(data.isAllRobotsDenied).toBe(false);
    expect(data.isPermissive).toBe(false);
  });
});

describe("parse()", () => {
  it("returns a RobotsFile wrapping the parsed data", () => {
    const file = parse("User-agent: *\nDisallow: /\n");
    expect(file.isAllowed("anybot", "https://example.com/page")).toBe(false);
  });

  it("simple fixture: allows /private/public/ but not /private/", () => {
    const file = parse(fixture("simple.txt"));
    expect(file.isAllowed("anybot", "https://example.com/private/page")).toBe(false);
    expect(file.isAllowed("anybot", "https://example.com/private/public/page")).toBe(true);
    expect(file.getSitemaps()).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("malformed fixture: parses without throwing", () => {
    const file = parse(fixture("malformed.txt"));
    expect(file).toBeDefined();
    // The valid rule /secret is inside the group
    expect(file.isAllowed("*", "https://example.com/secret/page")).toBe(false);
  });
});
