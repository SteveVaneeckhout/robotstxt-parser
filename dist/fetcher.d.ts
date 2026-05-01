import { RobotsFile } from "./robots-file.js";
import { type FetchOptions } from "./types.js";
export declare function fetchRobots(url: string | URL, options?: FetchOptions): Promise<RobotsFile>;
