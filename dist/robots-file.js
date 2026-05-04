import { findBestMatch, extractNormalizedPath } from "./matcher.js";
import {} from "./types.js";
export class RobotsFile {
  #data;
  meta;
  constructor(data, meta = null) {
    this.#data = data;
    this.meta = meta;
  }
  static createPermissive(meta = null) {
    return new RobotsFile(
      {
        groups: [],
        sitemaps: [],
        extensions: new Map(),
        isAllRobotsDenied: false,
        isPermissive: true,
      },
      meta,
    );
  }
  static createRestrictive(meta = null) {
    return new RobotsFile(
      {
        groups: [],
        sitemaps: [],
        extensions: new Map(),
        isAllRobotsDenied: true,
        isPermissive: false,
      },
      meta,
    );
  }
  /**
   * Returns true if the given user-agent is allowed to access the URL.
   * Follows RFC 9309: specific UA match takes precedence over wildcard '*'.
   */
  isAllowed(userAgent, url) {
    if (this.#data.isAllRobotsDenied) return false;
    if (this.#data.isPermissive) return true;
    const path = extractNormalizedPath(url);
    // /robots.txt is always implicitly allowed (RFC §2.2.2)
    if (path === "/robots.txt") return true;
    const agentLower = userAgent.toLowerCase();
    let matchingGroups = this.#data.groups.filter((g) =>
      g.userAgents.some((ua) => ua === agentLower),
    );
    if (matchingGroups.length === 0) {
      matchingGroups = this.#data.groups.filter((g) => g.userAgents.some((ua) => ua === "*"));
    }
    if (matchingGroups.length === 0) return true;
    const allRules = matchingGroups.flatMap((g) => g.rules);
    const best = findBestMatch(allRules, path);
    return best === null ? true : best.type === "allow";
  }
  getSitemaps() {
    return [...this.#data.sitemaps];
  }
  getExtensionValues(key) {
    return [...(this.#data.extensions.get(key.toLowerCase()) ?? [])];
  }
  get groups() {
    return this.#data.groups;
  }
  get isPermissive() {
    return this.#data.isPermissive;
  }
  get isRestrictive() {
    return this.#data.isAllRobotsDenied;
  }
}
