import { MAX_ROBOTS_BYTES } from "./constants.js";
import { RobotsFile } from "./robots-file.js";
import { type Group, type RobotsFileData, type Rule, type RuleType } from "./types.js";

const sizeEncoder = new TextEncoder();
const sizeDecoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
const HEX_RE = /^[0-9A-Fa-f]{2}$/;

function truncateToLimit(content: string): string {
  const bytes = sizeEncoder.encode(content);
  if (bytes.byteLength <= MAX_ROBOTS_BYTES) return content;
  return sizeDecoder.decode(bytes.slice(0, MAX_ROBOTS_BYTES));
}

function stripComment(line: string): string {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "%" && i + 2 < line.length && HEX_RE.test(line.slice(i + 1, i + 3))) {
      i += 3;
      continue;
    }
    if (line[i] === "#") {
      return line.slice(0, i);
    }
    i++;
  }
  return line;
}

type TokenKind = "user-agent" | "allow" | "disallow" | "sitemap" | "extension" | "empty";

interface Token {
  kind: TokenKind;
  key: string;
  value: string;
}

function tokenizeLine(raw: string): Token {
  const stripped = stripComment(raw).trim();
  if (!stripped) {
    return { kind: "empty", key: "", value: "" };
  }

  const colonIndex = stripped.indexOf(":");
  if (colonIndex === -1) {
    return { kind: "empty", key: "", value: "" };
  }

  const key = stripped.slice(0, colonIndex).trim().toLowerCase();
  const value = stripped.slice(colonIndex + 1).trim();

  let kind: TokenKind;
  switch (key) {
    case "user-agent":
      kind = "user-agent";
      break;
    case "allow":
      kind = "allow";
      break;
    case "disallow":
      kind = "disallow";
      break;
    case "sitemap":
      kind = "sitemap";
      break;
    default:
      kind = "extension";
      break;
  }

  return { kind, key, value };
}

export function parseContent(content: string): RobotsFileData {
  const text = truncateToLimit(content);
  const lines = text.split(/\r\n|\r|\n/);

  const groups: Group[] = [];
  const sitemaps: string[] = [];
  const extensions = new Map<string, string[]>();

  let currentAgents: string[] = [];
  let currentRules: Rule[] = [];
  let collectingAgents = false;
  let hasStarted = false;

  function flushGroup(): void {
    if (currentAgents.length > 0) {
      groups.push({ userAgents: currentAgents, rules: currentRules });
    }
    currentAgents = [];
    currentRules = [];
  }

  for (const raw of lines) {
    const token = tokenizeLine(raw);

    switch (token.kind) {
      case "user-agent": {
        const agent = token.value.toLowerCase();
        if (!agent) break;
        if (!collectingAgents && hasStarted) {
          flushGroup();
        }
        collectingAgents = true;
        hasStarted = true;
        currentAgents.push(agent);
        break;
      }

      case "allow":
      case "disallow": {
        if (!hasStarted) break;
        collectingAgents = false;
        if (!token.value) break;
        currentRules.push({ type: token.kind as RuleType, pattern: token.value });
        break;
      }

      case "sitemap": {
        if (token.value) {
          sitemaps.push(token.value);
        }
        break;
      }

      case "extension": {
        if (token.value) {
          const existing = extensions.get(token.key);
          if (existing !== undefined) {
            existing.push(token.value);
          } else {
            extensions.set(token.key, [token.value]);
          }
        }
        break;
      }

      case "empty":
        break;
    }
  }

  flushGroup();

  return { groups, sitemaps, extensions, isAllRobotsDenied: false, isPermissive: false };
}

export function parse(content: string): RobotsFile {
  return new RobotsFile(parseContent(content));
}
