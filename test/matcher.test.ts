import { describe, expect, it } from "vitest";
import {
  extractNormalizedPath,
  findBestMatch,
  matchPattern,
  normalizePath,
  patternByteLength,
} from "../src/matcher.js";
import { parse } from "../src/parser.js";
import type { Rule } from "../src/types.js";

describe("normalizePath – characters that must be percent-encoded", () => {
  it("percent-encodes non-ASCII characters as UTF-8", () => {
    expect(normalizePath("/café")).toBe("/caf%C3%A9");
    expect(normalizePath("/foo/bar/ツ")).toBe("/foo/bar/%E3%83%84");
  });

  it("encodes a surrogate pair as a single 4-byte sequence", () => {
    expect(normalizePath("/😀")).toBe("/%F0%9F%98%80");
  });

  it("percent-encodes ASCII characters that are neither unreserved nor reserved", () => {
    expect(normalizePath('/a b"<>{}|\\^`')).toBe("/a%20b%22%3C%3E%7B%7D%7C%5C%5E%60");
    expect(normalizePath("/\t")).toBe("/%09");
  });

  it("keeps reserved characters, including the * and $ pattern operators", () => {
    expect(normalizePath("/:/?#[]@!$&'()*+,;=")).toBe("/:/?#[]@!$&'()*+,;=");
  });

  it("keeps a bare % followed by non-hex and still encodes what follows", () => {
    expect(normalizePath("/100%é")).toBe("/100%%C3%A9");
  });

  it("is idempotent", () => {
    const once = normalizePath("/café/%7euser?q=a b");
    expect(normalizePath(once)).toBe(once);
  });
});

describe("rule pattern normalization (RFC 9309 §2.2.2)", () => {
  const allowed = (robots: string, path: string) =>
    parse(robots).isAllowed("bot", `https://example.com${path}`);

  it.each([
    // [rule pattern, URL path] pairs from the RFC 9309 §2.2.2 table, plus variants
    ["/foo/bar?baz=quz", "/foo/bar?baz=quz"],
    ["/foo/bar/ツ", "/foo/bar/%E3%83%84"],
    ["/foo/bar/ツ", "/foo/bar/ツ"],
    ["/foo/bar/%E3%83%84", "/foo/bar/%E3%83%84"],
    ["/foo/bar/%e3%83%84", "/foo/bar/ツ"],
    ["/foo/bar/%62%61%7A", "/foo/bar/baz"],
    ["/%7Euser", "/~user"],
    ["/café", "/café"],
    ["/caf*", "/café"],
    ["/café$", "/caf%c3%a9"],
  ])("Disallow: %s blocks %s", (pattern, path) => {
    expect(allowed(`User-agent: *\nDisallow: ${pattern}\n`, path)).toBe(false);
  });

  it("does not match a different non-ASCII path", () => {
    expect(allowed("User-agent: *\nDisallow: /café\n", "/cafe")).toBe(true);
  });

  it("ranks rules by their normalized length", () => {
    // "/caf%C3%A9" (10 bytes) beats "/caf" (4 bytes), however each rule was spelled.
    const robots = "User-agent: *\nDisallow: /caf\nAllow: /café\n";
    expect(allowed(robots, "/café/menu")).toBe(true);
    expect(allowed(robots, "/cafe")).toBe(false);
  });

  it("leaves the parsed rule patterns as written in the file", () => {
    expect(parse("User-agent: *\nDisallow: /café\n").groups[0]?.rules[0]?.pattern).toBe("/café");
  });

  it("matches the same rule object consistently across calls", () => {
    const rules: Rule[] = [{ type: "disallow", pattern: "/ツ" }];
    expect(findBestMatch(rules, "/%E3%83%84")).toBe(rules[0]);
    expect(findBestMatch(rules, "/%E3%83%84")).toBe(rules[0]);
  });
});

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

/** The previous O(m×n) DP matcher, kept as an oracle for the linear one. */
function referenceMatch(pattern: string, path: string): boolean {
  let p = pattern;
  let mustMatchEnd = false;

  if (p.endsWith("$")) {
    mustMatchEnd = true;
    p = p.slice(0, -1);
  }

  const m = p.length;
  const n = path.length;

  // Flat (m+1)×(n+1) boolean grid stored as a Uint8Array for efficiency.
  // Indices are always within [0, m] × [0, n], so no OOB access.
  const size = (m + 1) * (n + 1);
  const dp = new Uint8Array(size);
  const at = (row: number, col: number) => row * (n + 1) + col;

  dp[at(0, 0)] = 1;

  // A leading '*' can match an empty prefix
  for (let row = 1; row <= m; row++) {
    if (p[row - 1] === "*") {
      // Uint8Array index access is always defined for in-bounds indices
      dp[at(row, 0)] = dp[at(row - 1, 0)] as number;
    } else {
      break;
    }
  }

  for (let row = 1; row <= m; row++) {
    for (let col = 1; col <= n; col++) {
      if (p[row - 1] === "*") {
        dp[at(row, col)] = dp[at(row - 1, col)] !== 0 || dp[at(row, col - 1)] !== 0 ? 1 : 0;
      } else {
        dp[at(row, col)] = dp[at(row - 1, col - 1)] !== 0 && p[row - 1] === path[col - 1] ? 1 : 0;
      }
    }
  }

  if (mustMatchEnd) {
    return dp[at(m, n)] !== 0;
  }

  // Prefix match: pattern exhausted at any position in path
  for (let col = 0; col <= n; col++) {
    if (dp[at(m, col)] !== 0) return true;
  }
  return false;
}

/** Small deterministic PRNG (mulberry32) so the differential test is reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("matchPattern – agrees with the reference DP matcher", () => {
  it("on 20,000 random patterns and paths", () => {
    const next = rng(20261108);
    const pick = (alphabet: string, max: number) => {
      let s = "";
      const len = Math.floor(next() * (max + 1));
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(next() * alphabet.length)];
      return s;
    };
    for (let i = 0; i < 20_000; i++) {
      const pattern = pick("/ab*$", 8);
      const path = pick("/ab$", 10);
      expect(
        matchPattern(pattern, path),
        `${JSON.stringify(pattern)} vs ${JSON.stringify(path)}`,
      ).toBe(referenceMatch(pattern, path));
    }
  });
});

describe("matchPattern – performance", () => {
  it("matches 16,000 wildcard rules against a 5,000-character path quickly", () => {
    // The old DP matcher took more than 10 s here (a 500 KiB robots.txt, Google's size limit).
    const rules: Rule[] = Array.from({ length: 16_000 }, () => ({
      type: "disallow",
      pattern: "/a*b*c*d*e*f*g*h*i*j*$",
    }));
    const path = "/" + "ab".repeat(2_500);
    const start = performance.now();
    expect(findBestMatch(rules, path)).toBeNull();
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
