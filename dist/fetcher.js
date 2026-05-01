import {
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  MAX_ROBOTS_BYTES,
} from "./constants.js";
import { parseContent } from "./parser.js";
import { RobotsFile } from "./robots-file.js";
import {} from "./types.js";
function resolveOptions(options) {
  return {
    userAgent: options?.userAgent ?? DEFAULT_USER_AGENT,
    maxRedirects: options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxSizeBytes: options?.maxSizeBytes ?? MAX_ROBOTS_BYTES,
    signal: options?.signal,
  };
}
function robotsUrl(input) {
  const u = new URL(typeof input === "string" ? input : input.href);
  return new URL("/robots.txt", u);
}
async function fetchWithRedirectLimit(initialUrl, opts) {
  let currentUrl = initialUrl;
  let redirectCount = 0;
  while (true) {
    const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
    const signal =
      opts.signal !== undefined ? AbortSignal.any([timeoutSignal, opts.signal]) : timeoutSignal;
    let response;
    try {
      response = await globalThis.fetch(currentUrl.href, {
        redirect: "manual",
        headers: { "User-Agent": opts.userAgent },
        signal,
      });
    } catch {
      return { ok: false };
    }
    const { status } = response;
    if (status >= 300 && status < 400) {
      if (redirectCount >= opts.maxRedirects) {
        return { ok: false };
      }
      const location = response.headers.get("Location");
      if (location === null) return { ok: false };
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        return { ok: false };
      }
      redirectCount++;
      continue;
    }
    return { ok: true, response };
  }
}
async function readBodyUpToLimit(response, maxBytes) {
  const { body } = response;
  if (body === null) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  const reader = body.getReader();
  const chunks = [];
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
export async function fetchRobots(url, options) {
  const opts = resolveOptions(options);
  const targetUrl = robotsUrl(url);
  const outcome = await fetchWithRedirectLimit(targetUrl, opts);
  if (!outcome.ok) {
    return RobotsFile.createRestrictive();
  }
  const { response } = outcome;
  const { status } = response;
  if (status >= 400 && status < 500) {
    return RobotsFile.createPermissive();
  }
  if (status < 200 || status >= 300) {
    return RobotsFile.createRestrictive();
  }
  const content = await readBodyUpToLimit(response, opts.maxSizeBytes);
  return new RobotsFile(parseContent(content));
}
