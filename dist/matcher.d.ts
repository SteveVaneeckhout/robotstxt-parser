import { type Rule } from "./types.js";
/**
 * Normalizes percent-encoding in a path per RFC 3986:
 * - Unreserved ASCII chars (%41-5A, %61-7A, %30-39, %2D, %2E, %5F, %7E) are decoded.
 * - All other %XX sequences are kept encoded with uppercase hex digits.
 * - Invalid or incomplete %XX sequences are left as-is.
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
 * Uses O(m×n) DP to handle pathological wildcard inputs safely.
 */
export declare function matchPattern(pattern: string, path: string): boolean;
export declare function patternByteLength(pattern: string): number;
/**
 * Finds the best-matching rule for a path from a set of rules.
 * "Best" = longest pattern (by byte length); Allow beats Disallow on a tie.
 * Returns null if no rule matches.
 */
export declare function findBestMatch(rules: Rule[], path: string): Rule | null;
/**
 * Extracts and normalizes the path+query portion of a URL for matching.
 */
export declare function extractNormalizedPath(url: string | URL): string;
