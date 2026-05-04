import { type FetchMeta, type Group, type RobotsFileData } from "./types.js";
export declare class RobotsFile {
  #private;
  readonly meta: FetchMeta | null;
  constructor(data: RobotsFileData, meta?: FetchMeta | null);
  static createPermissive(meta?: FetchMeta | null): RobotsFile;
  static createRestrictive(meta?: FetchMeta | null): RobotsFile;
  /**
   * Returns true if the given user-agent is allowed to access the URL.
   * Follows RFC 9309: specific UA match takes precedence over wildcard '*'.
   */
  isAllowed(userAgent: string, url: string | URL): boolean;
  getSitemaps(): string[];
  getExtensionValues(key: string): string[];
  get groups(): readonly Group[];
  get isPermissive(): boolean;
  get isRestrictive(): boolean;
}
