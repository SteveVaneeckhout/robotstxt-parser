import {
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  MAX_ROBOTS_BYTES,
} from "./constants.js";
import { parseContent } from "./parser.js";
import { RobotsFile } from "./robots-file.js";
import { type FetchMeta, type FetchOptions } from "./types.js";

interface ResolvedOptions {
  userAgent: string;
  maxRedirects: number;
  timeoutMs: number;
  maxSizeBytes: number;
  signal: AbortSignal | undefined;
}

function resolveOptions(options?: FetchOptions): ResolvedOptions {
  return {
    userAgent: options?.userAgent ?? DEFAULT_USER_AGENT,
    maxRedirects: options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxSizeBytes: options?.maxSizeBytes ?? MAX_ROBOTS_BYTES,
    signal: options?.signal,
  };
}

function requestSignal(opts: ResolvedOptions): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  return opts.signal === undefined ? timeout : AbortSignal.any([timeout, opts.signal]);
}

function robotsUrl(siteUrl: string): URL {
  return new URL("/robots.txt", siteUrl);
}

interface FetchOutcome {
  response: Response | null;
  finalUrl: string;
  httpStatus: number | null;
  redirects: number;
}

async function fetchWithRedirectLimit(
  initialUrl: URL,
  opts: ResolvedOptions,
): Promise<FetchOutcome> {
  let currentUrl = initialUrl;
  let redirects = 0;

  while (true) {
    let response: Response;
    try {
      response = await globalThis.fetch(currentUrl.href, {
        redirect: "manual",
        headers: { "User-Agent": opts.userAgent },
        signal: requestSignal(opts),
      });
    } catch {
      // A caller-initiated abort is not "server unreachable": rethrow the caller's reason.
      opts.signal?.throwIfAborted();
      return {
        response: null,
        finalUrl: currentUrl.href,
        httpStatus: null,
        redirects,
      };
    }

    const { status } = response;

    if (status >= 300 && status < 400) {
      if (redirects >= opts.maxRedirects) {
        return { response: null, finalUrl: currentUrl.href, httpStatus: status, redirects };
      }
      const location = response.headers.get("Location");
      if (location === null) {
        return { response: null, finalUrl: currentUrl.href, httpStatus: status, redirects };
      }
      const nextUrl = URL.parse(location, currentUrl.href);
      if (nextUrl === null) {
        return { response: null, finalUrl: currentUrl.href, httpStatus: status, redirects };
      }
      currentUrl = nextUrl;
      redirects++;
      continue;
    }

    return {
      response,
      finalUrl: currentUrl.href,
      httpStatus: status,
      redirects,
    };
  }
}

async function readBodyUpToLimit(response: Response, maxBytes: number): Promise<string> {
  const { body } = response;
  if (body === null) return "";

  // A default TextDecoder strips a leading UTF-8 BOM, as Response.text() does.
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;

  // Breaking out of the loop (size cap reached) cancels the stream.
  for await (const chunk of body) {
    const remaining = maxBytes - totalBytes;
    if (chunk.byteLength > remaining) {
      text += decoder.decode(chunk.subarray(0, remaining), { stream: true });
      break;
    }
    text += decoder.decode(chunk, { stream: true });
    totalBytes += chunk.byteLength;
  }
  return text + decoder.decode();
}

export async function fetchRobots(siteUrl: string, options?: FetchOptions): Promise<RobotsFile> {
  const opts = resolveOptions(options);
  const targetUrl = robotsUrl(siteUrl);
  const outcome = await fetchWithRedirectLimit(targetUrl, opts);

  const baseMeta: Omit<FetchMeta, "contentType"> = {
    url: targetUrl.href,
    finalUrl: outcome.finalUrl,
    httpStatus: outcome.httpStatus,
    redirects: outcome.redirects,
  };

  if (outcome.response === null) {
    const meta: FetchMeta = { ...baseMeta, contentType: null };
    // A redirect chain that ran past the limit, or one we could not follow,
    // still means the server answered with a 3xx rather than failing. RFC 9309
    // §2.3.1.2 says to assume the file is "unavailable" in that case, and
    // §2.3.1.3 makes an unavailable robots.txt permissive. Only a genuinely
    // unreachable server -- no status at all -- disallows everything.
    if (outcome.httpStatus !== null) {
      return RobotsFile.createPermissive(meta);
    }
    return RobotsFile.createRestrictive(meta);
  }

  const { response } = outcome;
  const contentType = response.headers.get("content-type");
  const meta: FetchMeta = { ...baseMeta, contentType };
  const { status } = response;

  if (status >= 400 && status < 500) {
    return RobotsFile.createPermissive(meta);
  }

  if (status < 200 || status >= 300) {
    return RobotsFile.createRestrictive(meta);
  }

  const content = await readBodyUpToLimit(response, opts.maxSizeBytes);
  return new RobotsFile(parseContent(content), meta);
}
