import { type Group, type RobotsFileData } from "./types.js";
export declare class RobotsFile {
  #private;
  constructor(data: RobotsFileData);
  static createPermissive(): RobotsFile;
  static createRestrictive(): RobotsFile;
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
