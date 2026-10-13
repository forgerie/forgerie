import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAzurePrTools } from "./azurePrTools.js";

describe("Azure PR tool registration", () => {
  it("scopes all four actions to the current session and preserves omitted numbers", async () => {
    const calls: unknown[] = [];
    const [tool] = await createAzurePrTools("/workspace", { execute: (cwd, id, action, number) => { calls.push([cwd, id, action, number]); return Promise.resolve({ action }); } }, () => Promise.resolve({ organization: "org", project: "project", repository: "repo" }));
    if (tool === undefined) throw new Error("Tool missing");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- SDK context narrowed to the one capability this tool uses.
    const ctx = { sessionManager: { getSessionId: () => "session-7" } } as unknown as ExtensionToolContext;
    for (const action of ["read", "link", "watch", "stop"] as const) {
      await tool.execute("call", { action, number: 9 }, undefined, undefined, ctx);
    }
    await tool.execute("call", { action: "read" }, undefined, undefined, ctx);
    expect(calls).toEqual([["/workspace", "session-7", "read", 9], ["/workspace", "session-7", "link", 9], ["/workspace", "session-7", "watch", 9], ["/workspace", "session-7", "stop", 9], ["/workspace", "session-7", "read", undefined]]);
  });
  it.each([
    ["git@ssh.dev.azure.com:v3/amazeinsights/Amaze%20Insights/portal-source", ["azure_pr"]],
    ["https://github.com/owner/repo.git", []],
    ["https://example.test/repo.git", []],
  ])("registers only for the origin %s", async (origin, names) => {
    const cwd = await mkdtemp(join(tmpdir(), "azure-tools-"));
    try {
      execFileSync("git", ["init", "--initial-branch=main", cwd]); execFileSync("git", ["-C", cwd, "remote", "add", "origin", origin]);
      const tools = await createAzurePrTools(cwd, { execute: () => Promise.resolve({ readOnly: true }) });
      expect(tools.map((tool) => tool.name)).toEqual(names);
      if (tools[0]) {
        expect(tools[0].description).toContain("cannot create, merge, complete, vote, comment, or abandon");
        expect(tools[0].parameters).toMatchObject({ properties: { action: { anyOf: [{ const: "read" }, { const: "link" }, { const: "watch" }, { const: "stop" }] } } });
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
