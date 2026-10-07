import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";
import { createGitHubToolDefinitions, type GitHubToolDeps } from "./githubTools.js";
import { createPiWebCustomToolDefinitions } from "./piSessionService.js";

function ctxFor(sessionId: string): ExtensionToolContext {
  const sessionManager = { getSessionId: () => sessionId, getSessionFile: () => undefined };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub with the minimal surface the tool uses.
  return { sessionManager } as unknown as ExtensionToolContext;
}

describe("GitHub tools", () => {
  it("adds github_read and github_write to every hosted session, delegated or not, only when GitHub is wired", () => {
    const github: GitHubToolDeps = { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) };
    const names = (delegation: boolean) => createPiWebCustomToolDefinitions("/workspace", delegation, undefined, undefined, undefined, undefined, github).map((tool) => tool.name);
    expect(names(true)).toEqual(["edit", "github_read", "github_write"]);
    expect(names(false)).toEqual(["edit", "github_read", "github_write"]);
    expect(createPiWebCustomToolDefinitions("/workspace", true).map((tool) => tool.name)).toEqual(["edit"]);
  });

  it("keeps writes out of scripts so each one shows in the transcript, and lets scripts read", () => {
    const [read, write] = createGitHubToolDefinitions("/workspace", { read: () => Promise.resolve(""), write: () => Promise.resolve({ text: "" }) });
    expect(read).not.toHaveProperty("exposure");
    expect(write.exposure).toBe(MODEL_ONLY_EXPOSURE);
  });

  it("acts in the session's cwd and signs writes with the session id", async () => {
    const calls: unknown[] = [];
    const [read, write] = createGitHubToolDefinitions("/code/korri", {
      read: (cwd, request) => { calls.push(["read", cwd, request]); return Promise.resolve("#1 Issue"); },
      write: (cwd, sessionId, request) => { calls.push(["write", cwd, sessionId, request]); return Promise.resolve({ text: "Commented on #1.", url: "https://github.com/o/r/issues/1#c" }); },
    });
    const ctx = ctxFor("session-7");
    const readResult = await read.execute("t1", { action: "issues" }, undefined, undefined, ctx);
    const writeResult = await write.execute("t2", { action: "comment", number: 1, body: "Hi" }, undefined, undefined, ctx);
    expect(readResult.content).toEqual([{ type: "text", text: "#1 Issue" }]);
    expect(writeResult).toEqual({ content: [{ type: "text", text: "Commented on #1.\nhttps://github.com/o/r/issues/1#c" }], details: { action: "comment", url: "https://github.com/o/r/issues/1#c" } });
    expect(calls).toEqual([["read", "/code/korri", { action: "issues" }], ["write", "/code/korri", "session-7", { action: "comment", number: 1, body: "Hi" }]]);
  });
});
