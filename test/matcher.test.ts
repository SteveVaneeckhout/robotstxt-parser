import { describe, expect, it } from "vitest";
import {
  extractNormalizedPath,
  findBestMatch,
  matchPattern,
  normalizePath,
  patternByteLength,
} from "../src/matcher.js";
import type { Rule } from "../src/types.js";

describe("normalizePath", () => {
  it("passes through ordinary ASCII characters", () => {
    expect(normalizePath("/foo/bar")).toBe("/foo/bar");
    expect(normalizePath("")).toBe("");
  });

  it("decodes unreserved percent-encoded ASCII characters", () => {
    expect(normalizePath("%61%62%63")).toBe("abc"); // a b c
    expect(normalizePath("%41")).toBe("A");
    expect(normalizePath("%30")).toBe("0");
    expect(normalizePath("%2D")).toBe("-"); // hyphen
    expect(normalizePath("%2E")).toBe("."); // period
    expect(normalizePath("%5F")).toBe("_"); // underscore
    expect(normalizePath("%7E")).toBe("~"); // tilde
  });

  it("keeps reserved/non-unreserved ASCII sequences percent-encoded", () => {
    expect(normalizePath("%20")).toBe("%20"); // space
    expect(normalizePath("%2F")).toBe("%2F"); // slash (reserved)
    expect(normalizePath("%3F")).toBe("%3F"); // ? (reserved)
    expect(normalizePath("%23")).toBe("%23"); // # (reserved)
    expect(normalizePath("%3A")).toBe("%3A"); // : (reserved)
  });

  it("uppercases hex digits in kept sequences", () => {
    expect(normalizePath("%2f")).toBe("%2F");
    expect(normalizePath("%3a")).toBe("%3A");
    expect(normalizePath("%c3%a9")).toBe("%C3%A9");
  });

  it("keeps non-ASCII bytes percent-encoded (b > 0x7F)", () => {
    expect(normalizePath("%80")).toBe("%80");
    expect(normalizePath("%C3%A9")).toBe("%C3%A9"); // é in UTF-8
    expect(normalizePath("%FF")).toBe("%FF");
  });

  it("leaves invalid percent sequences character-by-character", () => {
    expect(normalizePath("%GG")).toBe("%GG");
    expect(normalizePath("%ZZ")).toBe("%ZZ");
    expect(normalizePath("%0G")).toBe("%0G");
  });

  it("handles % at end of string with too few following chars", () => {
    expect(normalizePath("foo%")).toBe("foo%");
    expect(normalizePath("foo%4")).toBe("foo%4");
  });

  it("handles mix of encoded and plain characters", () => {
    expect(normalizePath("/path/%61bc?q=%41")).toBe("/path/abc?q=A");
  });
});

describe("matchPattern", () => {
  it("matches a plain prefix", () => {
    expect(matchPattern("/foo", "/foo/bar")).toBe(true);
    expect(matchPattern("/foo/", "/foo/bar")).toBe(true);
    expect(matchPattern("/", "/anything")).toBe(true);
  });

  it("does not match when prefix differs", () => {
    expect(matchPattern("/foo", "/bar")).toBe(false);
    expect(matchPattern("/foo/", "/foobar")).toBe(false);
    expect(matchPattern("/xyz", "/abc")).toBe(false);
  });

  it("empty pattern prefix-matches any path", () => {
    expect(matchPattern("", "/anything")).toBe(true);
    expect(matchPattern("", "")).toBe(true);
  });

  it("$ anchors the pattern to end of path", () => {
    expect(matchPattern("/foo$", "/foo")).toBe(true);
    expect(matchPattern("/foo$", "/foo/bar")).toBe(false);
    expect(matchPattern("/foo$", "/foobar")).toBe(false);
  });

  it("$ only has special meaning at end of pattern", () => {
    // Literal $ in middle of pattern
    expect(matchPattern("/fo$o", "/fo$o")).toBe(true);
    expect(matchPattern("/fo$o", "/fo$o/extra")).toBe(true);
  });

  it("* matches zero or more characters", () => {
    expect(matchPattern("/foo*", "/foo")).toBe(true);
    expect(matchPattern("/foo*", "/foobar")).toBe(true);
    expect(matchPattern("/foo*", "/foo/deep/path")).toBe(true);
    expect(matchPattern("/*.gif", "/image.gif")).toBe(true);
    expect(matchPattern("/*.gif", "/sub/path/image.gif")).toBe(true);
  });

  it("* can match an empty segment", () => {
    expect(matchPattern("/foo/*", "/foo/")).toBe(true);
  });

  it("* in the middle matches multi-segment paths", () => {
    expect(matchPattern("/foo/*/bar", "/foo/x/bar")).toBe(true);
    expect(matchPattern("/foo/*/bar", "/foo/x/y/z/bar")).toBe(true);
    expect(matchPattern("/foo/*/bar", "/foo/bar")).toBe(false);
  });

  it("leading * in pattern matches empty prefix", () => {
    expect(matchPattern("*foo", "foo")).toBe(true);
    expect(matchPattern("*foo", "/long/prefix/foo")).toBe(true);
    expect(matchPattern("**foo", "foo")).toBe(true);
  });

  it("pattern starts with non-* char breaks the leading-* init loop", () => {
    expect(matchPattern("/foo", "/foo")).toBe(true);
    expect(matchPattern("/foo", "/bar")).toBe(false);
  });

  it("combined * and $ (RFC §5.1 gif example)", () => {
    expect(matchPattern("/*.gif$", "/image.gif")).toBe(true);
    expect(matchPattern("/*.gif$", "/image.gif?size=large")).toBe(false);
    expect(matchPattern("/*.gif$", "/image.gif.backup")).toBe(false);
    expect(matchPattern("/*.gif$", "/sub/image.gif")).toBe(true);
  });

  it("handles pathological wildcards without exponential blowup", () => {
    const longPath = "/" + "a/".repeat(50);
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      matchPattern("/" + "*/".repeat(20), longPath);
    }
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("all-star pattern matches anything", () => {
    expect(matchPattern("*", "")).toBe(true);
    expect(matchPattern("*", "/any/path")).toBe(true);
  });
});

describe("findBestMatch", () => {
  it("returns null for an empty rule list", () => {
    expect(findBestMatch([], "/foo")).toBeNull();
  });

  it("returns null when no rule matches", () => {
    const rules: Rule[] = [{ type: "disallow", pattern: "/bar" }];
    expect(findBestMatch(rules, "/foo")).toBeNull();
  });

  it("returns the single matching rule", () => {
    const rules: Rule[] = [{ type: "disallow", pattern: "/foo" }];
    expect(findBestMatch(rules, "/foo/bar")).toEqual({ type: "disallow", pattern: "/foo" });
  });

  it("RFC §5.2: longest match wins (disallow longer than allow)", () => {
    const rules: Rule[] = [
      { type: "allow", pattern: "/example/page/" },
      { type: "disallow", pattern: "/example/page/disallowed.gif" },
    ];
    const result = findBestMatch(rules, "/example/page/disallowed.gif");
    expect(result).toEqual({ type: "disallow", pattern: "/example/page/disallowed.gif" });
  });

  it("allow beats disallow on equal-length patterns", () => {
    const rules: Rule[] = [
      { type: "disallow", pattern: "/foo" },
      { type: "allow", pattern: "/foo" },
    ];
    expect(findBestMatch(rules, "/foo/bar")?.type).toBe("allow");
  });

  it("equal-length allow does not replace allow (first wins)", () => {
    const rules: Rule[] = [
      { type: "allow", pattern: "/foo" },
      { type: "allow", pattern: "/foo" },
    ];
    expect(findBestMatch(rules, "/foo/bar")?.type).toBe("allow");
  });

  it("equal-length disallow keeps first when second is also disallow", () => {
    const rules: Rule[] = [
      { type: "disallow", pattern: "/foo" },
      { type: "disallow", pattern: "/foo" },
    ];
    expect(findBestMatch(rules, "/foo/bar")?.type).toBe("disallow");
  });

  it("longer disallow beats shorter allow", () => {
    const rules: Rule[] = [
      { type: "allow", pattern: "/foo" },
      { type: "disallow", pattern: "/foo/bar" },
    ];
    expect(findBestMatch(rules, "/foo/bar/baz")).toEqual({
      type: "disallow",
      pattern: "/foo/bar",
    });
  });

  it("skips non-matching rules entirely", () => {
    const rules: Rule[] = [
      { type: "disallow", pattern: "/other" },
      { type: "allow", pattern: "/foo" },
    ];
    expect(findBestMatch(rules, "/foo/bar")?.type).toBe("allow");
  });
});

describe("extractNormalizedPath", () => {
  it("extracts path from a string URL", () => {
    expect(extractNormalizedPath("https://example.com/foo/bar")).toBe("/foo/bar");
  });

  it("extracts path from a URL object", () => {
    expect(extractNormalizedPath(new URL("https://example.com/foo/bar"))).toBe("/foo/bar");
  });

  it("includes query string in the path", () => {
    expect(extractNormalizedPath("https://example.com/search?q=test&lang=en")).toBe(
      "/search?q=test&lang=en",
    );
  });

  it("empty query string produces empty search suffix", () => {
    const result = extractNormalizedPath("https://example.com/foo");
    expect(result).toBe("/foo");
    expect(result.includes("?")).toBe(false);
  });

  it("normalizes percent-encoding in the path", () => {
    expect(extractNormalizedPath("https://example.com/%61%62%63")).toBe("/abc");
  });
});

describe("patternByteLength", () => {
  it("counts ASCII bytes correctly", () => {
    expect(patternByteLength("/foo")).toBe(4);
    expect(patternByteLength("")).toBe(0);
  });

  it("counts multi-byte UTF-8 characters", () => {
    // 'é' is 2 bytes in UTF-8
    expect(patternByteLength("/café")).toBe(6);
  });
});
