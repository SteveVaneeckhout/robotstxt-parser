export type RuleType = "allow" | "disallow";

export interface Rule {
  type: RuleType;
  pattern: string;
}

export interface Group {
  userAgents: string[];
  rules: Rule[];
}

export interface RobotsFileData {
  groups: Group[];
  sitemaps: string[];
  extensions: Map<string, string[]>;
  isAllRobotsDenied: boolean;
  isPermissive: boolean;
}

export interface FetchOptions {
  userAgent?: string;
  maxRedirects?: number;
  timeoutMs?: number;
  maxSizeBytes?: number;
  /**
   * Cancels the request; combined with the `timeoutMs` deadline. When it aborts,
   * `fetchRobots` rejects with the signal's `reason` instead of returning a
   * restrictive result.
   */
  signal?: AbortSignal;
}

export interface FetchMeta {
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  redirects: number;
}
