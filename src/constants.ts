export const MAX_ROBOTS_BYTES = 500 * 1024;

// RFC 3986 §2.3 unreserved characters — safe to decode from percent-encoding
export const UNRESERVED_PATTERN = /^[A-Za-z0-9\-._~]$/;

// RFC 3986 §2.2 reserved characters (gen-delims + sub-delims) — allowed literally in a URI,
// never decoded from percent-encoding. Includes the robots.txt pattern operators `*` and `$`.
export const RESERVED_PATTERN = /^[:/?#[\]@!$&'()*+,;=]$/;

export const DEFAULT_USER_AGENT = "robots-txt-parser/1.0";
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 10_000;
