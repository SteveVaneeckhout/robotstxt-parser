import { UNRESERVED_PATTERN } from "./constants.js";
import { type Rule } from "./types.js";

const HEX_RE = /^[0-9A-Fa-f]{2}$/;
const encoder = new TextEncoder();

/**
 * Normalizes percent-encoding in a path per RFC 3986:
 * - Unreserved ASCII chars (%41-5A, %61-7A, %30-39, %2D, %2E, %5F, %7E) are decoded.
 * - All other %XX sequences are kept encoded with uppercase hex digits.
 * - Invalid or incomplete %XX sequences are left as-is.
 */
export function normalizePath(raw: string): string {
  let result = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "%" && i + 2 < raw.length) {
      const hex = raw.slice(i + 1, i + 3);
      if (HEX_RE.test(hex)) {
        const b = parseInt(hex, 16);
        if (b <= 0x7f) {
          const char = String.fromCharCode(b);
          if (UNRESERVED_PATTERN.test(char)) {
            result += char;
          } else {
            result += "%" + hex.toUpperCase();
          }
        } else {
          result += "%" + hex.toUpperCase();
        }
        i += 3;
        continue;
      }
    }
    result += raw[i];
    i++;
  }
  return result;
}

/**
 * Matches a robots.txt path pattern against a normalized URL path.
 * Supports:
 * - Prefix matching (no wildcard)
 * - '*' wildcard (zero or more of any character)
 * - '$' end anchor (pattern must match end of path when trailing)
 *
 * Both pattern and path must already be percent-encoding normalized.
 * Uses O(m×n) DP to handle pathological wildcard inputs safely.
 */
export function matchPattern(pattern: string, path: string): boolean {
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

export function patternByteLength(pattern: string): number {
  return encoder.encode(pattern).byteLength;
}

/**
 * Finds the best-matching rule for a path from a set of rules.
 * "Best" = longest pattern (by byte length); Allow beats Disallow on a tie.
 * Returns null if no rule matches.
 */
export function findBestMatch(rules: Rule[], path: string): Rule | null {
  let bestRule: Rule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (matchPattern(rule.pattern, path)) {
      const score = patternByteLength(rule.pattern);
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
