import { describe, expect, it } from "vitest";
import { RobotsFile } from "../src/robots-file.js";
import type { RobotsFileData } from "../src/types.js";

function makeData(partial: Partial<RobotsFileData> = {}): RobotsFileData {
  return {
    groups: [],
    sitemaps: [],
    extensions: new Map(),
    isAllRobotsDenied: false,
    isPermissive: false,
    ...partial,
  };
}

describe("RobotsFile.createPermissive()", () => {
  it("allows any URL", () => {
    const f = RobotsFile.createPermissive();
    expect(f.isAllowed("anybot", "https://example.com/anything")).toBe(true);
  });

  it("exposes isPermissive = true", () => {
    expect(RobotsFile.createPermissive().isPermissive).toBe(true);
  });

  it("exposes isRestrictive = false", () => {
    expect(RobotsFile.createPermissive().isRestrictive).toBe(false);
  });
});

describe("RobotsFile.createRestrictive()", () => {
  it("disallows any URL", () => {
    const f = RobotsFile.createRestrictive();
    expect(f.isAllowed("anybot", "https://example.com/anything")).toBe(false);
  });

  it("exposes isRestrictive = true", () => {
    expect(RobotsFile.createRestrictive().isRestrictive).toBe(true);
  });

  it("exposes isPermissive = false", () => {
    expect(RobotsFile.createRestrictive().isPermissive).toBe(false);
  });
});

describe("RobotsFile.isAllowed()", () => {
  it("always allows /robots.txt (implicit RFC allow)", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["*"], rules: [{ type: "disallow", pattern: "/" }] }],
      }),
    );
    expect(f.isAllowed("anybot", "https://example.com/robots.txt")).toBe(true);
  });

  it("returns true when no groups match the user-agent at all", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["googlebot"], rules: [{ type: "disallow", pattern: "/" }] }],
      }),
    );
    expect(f.isAllowed("bingbot", "https://example.com/page")).toBe(true);
  });

  it("falls back to the wildcard * group when no specific match", () => {
    const f = new RobotsFile(
      makeData({
        groups: [
          { userAgents: ["googlebot"], rules: [{ type: "allow", pattern: "/" }] },
          { userAgents: ["*"], rules: [{ type: "disallow", pattern: "/" }] },
        ],
      }),
    );
    expect(f.isAllowed("bingbot", "https://example.com/page")).toBe(false);
  });

  it("specific agent match takes precedence over wildcard", () => {
    const f = new RobotsFile(
      makeData({
        groups: [
          { userAgents: ["testbot"], rules: [{ type: "allow", pattern: "/" }] },
          { userAgents: ["*"], rules: [{ type: "disallow", pattern: "/" }] },
        ],
      }),
    );
    expect(f.isAllowed("testbot", "https://example.com/page")).toBe(true);
  });

  it("matches user-agent case-insensitively", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["googlebot"], rules: [{ type: "disallow", pattern: "/" }] }],
      }),
    );
    expect(f.isAllowed("Googlebot", "https://example.com/page")).toBe(false);
    expect(f.isAllowed("GOOGLEBOT", "https://example.com/page")).toBe(false);
  });

  it("returns true when the best matching rule is allow", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["*"], rules: [{ type: "allow", pattern: "/foo" }] }],
      }),
    );
    expect(f.isAllowed("anybot", "https://example.com/foo/bar")).toBe(true);
  });

  it("returns false when the best matching rule is disallow", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["*"], rules: [{ type: "disallow", pattern: "/foo" }] }],
      }),
    );
    expect(f.isAllowed("anybot", "https://example.com/foo/bar")).toBe(false);
  });

  it("returns true when rules exist but none match the path", () => {
    const f = new RobotsFile(
      makeData({
        groups: [{ userAgents: ["*"], rules: [{ type: "disallow", pattern: "/bar" }] }],
      }),
    );
    expect(f.isAllowed("anybot", "https://example.com/foo")).toBe(true);
  });

  it("merges rules from multiple groups with the same agent", () => {
    const f = new RobotsFile(
      makeData({
        groups: [
          { userAgents: ["testbot"], rules: [{ type: "disallow", pattern: "/a" }] },
          { userAgents: ["testbot"], rules: [{ type: "disallow", pattern: "/b" }] },
        ],
      }),
    );
    expect(f.isAllowed("testbot", "https://example.com/a")).toBe(false);
    expect(f.isAllowed("testbot", "https://example.com/b")).toBe(false);
  });
});

describe("RobotsFile.getSitemaps()", () => {
  it("returns all sitemaps", () => {
    const f = new RobotsFile(
      makeData({
        sitemaps: ["https://a.com/s.xml", "https://b.com/s.xml"],
      }),
    );
    expect(f.getSitemaps()).toEqual(["https://a.com/s.xml", "https://b.com/s.xml"]);
  });

  it("returns a copy — mutating the result does not affect internal state", () => {
    const f = new RobotsFile(makeData({ sitemaps: ["https://a.com/s.xml"] }));
    const sitemaps = f.getSitemaps();
    sitemaps.push("https://injected.com/s.xml");
    expect(f.getSitemaps()).toHaveLength(1);
  });

  it("returns empty array when no sitemaps", () => {
    expect(new RobotsFile(makeData()).getSitemaps()).toEqual([]);
  });
});

describe("RobotsFile.getExtensionValues()", () => {
  it("returns values for a known extension key", () => {
    const f = new RobotsFile(
      makeData({
        extensions: new Map([["llms", ["https://example.com/llms.txt"]]]),
      }),
    );
    expect(f.getExtensionValues("llms")).toEqual(["https://example.com/llms.txt"]);
  });

  it("is case-insensitive for the key", () => {
    const f = new RobotsFile(
      makeData({
        extensions: new Map([["llms", ["value"]]]),
      }),
    );
    expect(f.getExtensionValues("LLMS")).toEqual(["value"]);
    expect(f.getExtensionValues("Llms")).toEqual(["value"]);
  });

  it("returns an empty array for an unknown key", () => {
    expect(new RobotsFile(makeData()).getExtensionValues("unknown")).toEqual([]);
  });

  it("returns a copy — mutating the result does not affect internal state", () => {
    const f = new RobotsFile(
      makeData({
        extensions: new Map([["foo", ["bar"]]]),
      }),
    );
    const vals = f.getExtensionValues("foo");
    vals.push("injected");
    expect(f.getExtensionValues("foo")).toHaveLength(1);
  });
});

describe("RobotsFile.groups", () => {
  it("exposes the parsed groups", () => {
    const groups = [{ userAgents: ["*"], rules: [{ type: "disallow" as const, pattern: "/" }] }];
    const f = new RobotsFile(makeData({ groups }));
    expect(f.groups).toHaveLength(1);
    expect(f.groups[0]?.userAgents).toEqual(["*"]);
  });
});
