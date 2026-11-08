import { type Rule } from "./types.js";
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
export declare function normalizePath(raw: string): string;
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
export declare function matchPattern(pattern: string, path: string): boolean;
export declare function patternByteLength(pattern: string): number;
/**
 * Finds the best-matching rule for a normalized path (see `normalizePath`) from a set of
 * rules. Rule patterns are normalized the same way before matching.
 * "Best" = longest normalized pattern (by byte length); Allow beats Disallow on a tie.
 * Returns null if no rule matches.
 */
export declare function findBestMatch(rules: Rule[], path: string): Rule | null;
/**
 * Extracts and normalizes the path+query portion of a URL for matching.
 */
export declare function extractNormalizedPath(url: string | URL): string;
