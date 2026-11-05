import { RESERVED_PATTERN, UNRESERVED_PATTERN } from "./constants.js";
import {} from "./types.js";
const HEX_RE = /^[0-9A-Fa-f]{2}$/;
const encoder = new TextEncoder();
function percentEncode(char) {
    return Array.from(encoder.encode(char), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
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
export function normalizePath(raw) {
    let result = "";
    let i = 0;
    while (i < raw.length) {
        if (raw[i] === "%") {
            const hex = raw.slice(i + 1, i + 3);
            if (HEX_RE.test(hex)) {
                const char = String.fromCharCode(parseInt(hex, 16));
                result += UNRESERVED_PATTERN.test(char) ? char : `%${hex.toUpperCase()}`;
                i += 3;
            }
            else {
                result += "%";
                i++;
            }
            continue;
        }
        // Step by code point so a surrogate pair is encoded as one 4-byte UTF-8 sequence.
        const char = String.fromCodePoint(raw.codePointAt(i));
        result +=
            UNRESERVED_PATTERN.test(char) || RESERVED_PATTERN.test(char) ? char : percentEncode(char);
        i += char.length;
    }
    return result;
}
// Rules are immutable once parsed, so each pattern is normalized at most once.
const normalizedPatterns = new WeakMap();
function normalizedPattern(rule) {
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
 * Uses O(m×n) DP to handle pathological wildcard inputs safely.
 */
export function matchPattern(pattern, path) {
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
    const at = (row, col) => row * (n + 1) + col;
    dp[at(0, 0)] = 1;
    // A leading '*' can match an empty prefix
    for (let row = 1; row <= m; row++) {
        if (p[row - 1] === "*") {
            // Uint8Array index access is always defined for in-bounds indices
            dp[at(row, 0)] = dp[at(row - 1, 0)];
        }
        else {
            break;
        }
    }
    for (let row = 1; row <= m; row++) {
        for (let col = 1; col <= n; col++) {
            if (p[row - 1] === "*") {
                dp[at(row, col)] = dp[at(row - 1, col)] !== 0 || dp[at(row, col - 1)] !== 0 ? 1 : 0;
            }
            else {
                dp[at(row, col)] = dp[at(row - 1, col - 1)] !== 0 && p[row - 1] === path[col - 1] ? 1 : 0;
            }
        }
    }
    if (mustMatchEnd) {
        return dp[at(m, n)] !== 0;
    }
    // Prefix match: pattern exhausted at any position in path
    for (let col = 0; col <= n; col++) {
        if (dp[at(m, col)] !== 0)
            return true;
    }
    return false;
}
export function patternByteLength(pattern) {
    return encoder.encode(pattern).byteLength;
}
/**
 * Finds the best-matching rule for a normalized path (see `normalizePath`) from a set of
 * rules. Rule patterns are normalized the same way before matching.
 * "Best" = longest normalized pattern (by byte length); Allow beats Disallow on a tie.
 * Returns null if no rule matches.
 */
export function findBestMatch(rules, path) {
    let bestRule = null;
    let bestScore = -1;
    for (const rule of rules) {
        const pattern = normalizedPattern(rule);
        if (matchPattern(pattern, path)) {
            const score = patternByteLength(pattern);
            if (score > bestScore) {
                bestScore = score;
                bestRule = rule;
            }
            else if (score === bestScore && rule.type === "allow" && bestRule?.type === "disallow") {
                bestRule = rule;
            }
        }
    }
    return bestRule;
}
/**
 * Extracts and normalizes the path+query portion of a URL for matching.
 */
export function extractNormalizedPath(url) {
    const u = url instanceof URL ? url : new URL(url);
    return normalizePath(u.pathname + u.search);
}
