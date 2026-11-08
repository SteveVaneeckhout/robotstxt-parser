import { RESERVED_PATTERN, UNRESERVED_PATTERN } from "./constants.js";
import { type Rule } from "./types.js";

const HEX_RE = /^[0-9A-Fa-f]{2}$/;
const encoder = new TextEncoder();

function percentEncode(char: string): string {
  return Array.from(
    encoder.encode(char),
    (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");
}

/**
 * Brings a URL path or a robots.txt rule pattern into one canonical form (RFC 3986 and
 * RFC 9309 §2.2.2), so that equivalent spellings compare equal:
 * - %XX of an unreserved ASCII char (letters, digits, `-._~`) is decoded.
 * - All other valid %XX sequences are kept, with uppercase hex digits.
 * - Unreserved and reserved characters (including `*` and `$`) are kept as-is.
 * - Every other character — non-ASCII, space, `"`, `<`, `>`, `{`, controls… — is
 *   percent-encoded as UTF-8, e.g. `é` → `%C3%A9`.
 * - A `%` that doesn't start a valid %XX sequence is left as-is.
 */
export function normalizePath(raw: string): string {
  let result = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "%") {
      const hex = raw.slice(i + 1, i + 3);
      if (HEX_RE.test(hex)) {
        const char = String.fromCharCode(parseInt(hex, 16));
        result += UNRESERVED_PATTERN.test(char) ? char : `%${hex.toUpperCase()}`;
        i += 3;
      } else {
        result += "%";
        i++;
      }
      continue;
    }
    // Step by code point so a surrogate pair is encoded as one 4-byte UTF-8 sequence.
    const char = String.fromCodePoint(raw.codePointAt(i)!);
    result +=
      UNRESERVED_PATTERN.test(char) || RESERVED_PATTERN.test(char) ? char : percentEncode(char);
    i += char.length;
  }
  return result;
}

// Rules are immutable once parsed, so each pattern is normalized at most once.
const normalizedPatterns = new WeakMap<Rule, string>();

function normalizedPattern(rule: Rule): string {
  return normalizedPatterns.getOrInsertComputed(rule, (r) => normalizePath(r.pattern));
}

/**
 * Matches a robots.txt path pattern against a normalized URL path.
 * Supports:
 * - Prefix matching (no wildcard)
 * - '*' wildcard (zero or more of any character)
 * - '$' end anchor (pattern must match end of path when trailing)
 *
 * Both pattern and path must already be percent-encoding normalized.
 *
 * Runs in linear time with no allocation beyond splitting the pattern on '*'. Since '*' is the
 * only wildcard, matching each literal segment at its leftmost possible position is optimal:
 * it leaves the longest possible rest of the path for the remaining segments.
 */
export function matchPattern(pattern: string, path: string): boolean {
  const mustMatchEnd = pattern.endsWith("$");
  const p = mustMatchEnd ? pattern.slice(0, -1) : pattern;

  const segments = p.split("*");
  if (segments.length === 1) {
    return mustMatchEnd ? path === p : path.startsWith(p);
  }

  // The part before the first '*' anchors at the start of the path.
  const first = segments[0]!;
  if (!path.startsWith(first)) return false;
  let pos = first.length;

  // With '$', the part after the last '*' must end the path, so it is checked separately.
  const last = segments.length - 1;
  const middleEnd = mustMatchEnd ? last : segments.length;
  for (let i = 1; i < middleEnd; i++) {
    const segment = segments[i]!;
    const found = path.indexOf(segment, pos);
    if (found === -1) return false;
    pos = found + segment.length;
  }

  if (!mustMatchEnd) return true;
  const tail = segments[last]!;
  return path.length - tail.length >= pos && path.endsWith(tail);
}

export function patternByteLength(pattern: string): number {
  return encoder.encode(pattern).byteLength;
}

/**
 * Finds the best-matching rule for a normalized path (see `normalizePath`) from a set of
 * rules. Rule patterns are normalized the same way before matching.
 * "Best" = longest normalized pattern (by byte length); Allow beats Disallow on a tie.
 * Returns null if no rule matches.
 */
export function findBestMatch(rules: Rule[], path: string): Rule | null {
  let bestRule: Rule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const pattern = normalizedPattern(rule);
    if (matchPattern(pattern, path)) {
      const score = patternByteLength(pattern);
      if (score > bestScore) {
        bestScore = score;
        bestRule = rule;
      } else if (score === bestScore && rule.type === "allow" && bestRule?.type === "disallow") {
        bestRule = rule;
      }
    }
  }

  return bestRule;
}

/**
 * Extracts and normalizes the path+query portion of a URL for matching.
 */
export function extractNormalizedPath(url: string | URL): string {
  const u = url instanceof URL ? url : new URL(url);
  return normalizePath(u.pathname + u.search);
}
