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
}

function resolveOptions(options?: FetchOptions): ResolvedOptions {
  return {
    userAgent: options?.userAgent ?? DEFAULT_USER_AGENT,
    maxRedirects: options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxSizeBytes: options?.maxSizeBytes ?? MAX_ROBOTS_BYTES,
  };
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
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch {
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
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
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

  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      const remaining = maxBytes - totalBytes;
      if (chunk.byteLength <= remaining) {
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      } else {
        chunks.push(chunk.slice(0, remaining));
        totalBytes = maxBytes;
        break;
      }
    }
  } finally {
    await reader.cancel();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(combined);
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
