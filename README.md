# robots-txt-parser

RFC 9309 compliant robots.txt parser and fetcher for Node.js 24+.  
Zero runtime dependencies. ESM only. Full TypeScript types included.
Made with Claude.ai

Supports the core RFC 9309 standard plus common extensions: `Sitemap`, `LLMS`, and wildcard `*` / `$` anchors in `Allow`/`Disallow` paths (Google spec).

## Installation

```sh
npm install robots-txt-parser
```

## Quick start

```ts
import { parse, fetchRobots } from "robots-txt-parser";

// Parse a string directly
const robots = parse(`
  User-agent: *
  Disallow: /private/
  Allow: /private/public/
  Sitemap: https://example.com/sitemap.xml
`);

robots.isAllowed("googlebot", "https://example.com/page"); // true
robots.isAllowed("googlebot", "https://example.com/private/page"); // false
robots.isAllowed("googlebot", "https://example.com/private/public/page"); // true
robots.getSitemaps(); // ['https://example.com/sitemap.xml']

// Fetch and parse — pass the site origin; /robots.txt is appended
const live = await fetchRobots("https://example.com");
live.isAllowed("mybot", "https://example.com/some/page");
live.meta?.httpStatus; // 200, 404, etc. — or null if unreachable
```

## API

### `parse(content: string): RobotsFile`

Parses a robots.txt string and returns a [`RobotsFile`](#robotsfile) instance. The entire string is parsed in memory; use [`fetchRobots()`](#fetchrobotssiteurl-options-promiserobotsfile) when downloading from the network so the 500 KiB size limit is enforced.

When you obtain a `RobotsFile` via `parse()`, its `meta` property is `null`.

---

### `fetchRobots(siteUrl, options?): Promise<RobotsFile>`

Downloads the robots.txt at the root of the given URL's origin — e.g. passing `https://example.com/any/path` fetches `https://example.com/robots.txt` — then parses and returns it. **Never throws** for HTTP or network problems; the spec-mandated fallback is encoded in the returned `RobotsFile`, and the actual outcome is exposed via `meta`.

HTTP behaviour follows RFC 9309:

| Response             | Result                                           |
| -------------------- | ------------------------------------------------ |
| 2xx                  | Parsed normally                                  |
| 4xx                  | Permissive — `isAllowed` always returns `true`   |
| 5xx or network error | Restrictive — `isAllowed` always returns `false` |
| > maxRedirects       | Restrictive                                      |

**`FetchOptions`**

| Option         | Type     | Default                   | Description                               |
| -------------- | -------- | ------------------------- | ----------------------------------------- |
| `userAgent`    | `string` | `'robots-txt-parser/1.0'` | `User-Agent` header sent with the request |
| `maxRedirects` | `number` | `5`                       | Maximum redirects to follow (0 disables)  |
| `timeoutMs`    | `number` | `10000`                   | Request timeout in milliseconds           |
| `maxSizeBytes` | `number` | `512 * 1024`              | Response body cap in bytes                |

---

### `RobotsFile`

The object returned by both `parse()` and `fetchRobots()`.

#### `isAllowed(userAgent: string, url: string | URL): boolean`

Returns `true` if the given crawler is permitted to access the URL.

Matching follows RFC 9309:

1. `/robots.txt` is always allowed regardless of any rules.
2. A group whose `User-agent` exactly matches (case-insensitive) is used first.
3. If no specific match, the `*` wildcard group is used.
4. If no group matches at all, every path is allowed.
5. The **longest** matching pattern wins. `Allow` beats `Disallow` on a tie.

URL path matching is case-sensitive. The query string is included in matching.

#### `getSitemaps(): string[]`

Returns all `Sitemap` values found in the file.

#### `getExtensionValues(key: string): string[]`

Returns values for any non-standard field. Key lookup is case-insensitive. Multiple occurrences of the same key are accumulated in order.

```ts
const robots = parse("LLMS: https://example.com/llms.txt\n...");
robots.getExtensionValues("llms"); // ['https://example.com/llms.txt']
```

#### `groups: readonly Group[]`

The raw parsed groups, each containing `userAgents: string[]` and `rules: Rule[]`. Useful for introspecting the full structure of the file.

#### `isPermissive: boolean`

`true` when the server returned a 4xx response (all paths are allowed).

#### `isRestrictive: boolean`

`true` when the server returned a 5xx response or was unreachable (all paths are blocked).

#### `meta: FetchMeta | null`

Populated when the `RobotsFile` was produced by `fetchRobots()`; `null` when produced by `parse()`.

```ts
interface FetchMeta {
  url: string; // the /robots.txt URL we requested
  finalUrl: string; // URL after redirects (or last URL attempted on failure)
  httpStatus: number | null; // HTTP status, or null if no response (timeout/DNS/etc.)
  contentType: string | null;
  redirects: number; // number of redirects followed
}
```

You can use this to distinguish a real 200 OK with empty rules from a 404-derived permissive file, or to log/inspect what actually happened.

---

## Path pattern syntax

| Pattern        | Behaviour                                                      |
| -------------- | -------------------------------------------------------------- |
| `/path/`       | Prefix — matches any URL whose path starts with `/path/`       |
| `/path/*`      | Wildcard — `*` matches zero or more characters (including `/`) |
| `/path/$`      | End anchor — path must end exactly here                        |
| `/path/*.pdf$` | Combined — only URLs ending with `.pdf` under `/path/`         |

The **longer** (in bytes) of two matching patterns always wins. When two patterns are equal length, `Allow` beats `Disallow`.

```
User-agent: *
Allow:    /example/page/
Disallow: /example/page/blocked.gif
```

`/example/page/blocked.gif` → **disallowed** because `Disallow: /example/page/blocked.gif` (28 bytes) beats `Allow: /example/page/` (14 bytes).

---

## Percent-encoding

Paths are normalised before matching per RFC 3986:

- **Unreserved** characters (`A–Z`, `a–z`, `0–9`, `-`, `.`, `_`, `~`) are decoded from their `%XX` form.
- **Reserved** characters (`%2F`, `%3F`, `%23`, etc.) remain encoded.
- Non-ASCII sequences remain encoded.

`/foo%2Fbar` (encoded slash) and `/foo/bar` are therefore distinct paths.

---

## Extensions

Non-standard fields are collected and accessible via `getExtensionValues()`:

```
Sitemap: https://example.com/sitemap.xml   → getSitemaps()
LLMS: https://example.com/llms.txt         → getExtensionValues('llms')
X-Custom: value1                            → getExtensionValues('x-custom')
X-Custom: value2                               returns ['value1', 'value2']
```

`Sitemap` lines do not terminate the current rule group, in accordance with RFC 9309 §2.2.4.

---

## Requirements

- Node.js >= 24.15.0
- No runtime dependencies
