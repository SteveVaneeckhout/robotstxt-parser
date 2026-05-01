export const MAX_ROBOTS_BYTES = 500 * 1024;

// RFC 3986 §2.2 reserved characters — must NOT be decoded from percent-encoding
export const RFC3986_RESERVED = new Set([
  ":",
  "/",
  "?",
  "#",
  "[",
  "]",
  "@",
  "!",
  "$",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  ";",
  "=",
]);

// RFC 3986 §2.3 unreserved characters — safe to decode from percent-encoding
export const UNRESERVED_PATTERN = /^[A-Za-z0-9\-._~]$/;

export const DEFAULT_USER_AGENT = "robots-txt-parser/1.0";
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 10_000;
