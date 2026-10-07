import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorktreeHook } from "./worktreeHooks.js";

const posix = process.platform === "win32" ? it.skip : it;
describe("worktree hook execution", () => {
  posix("runs in the configured cwd with a literal path argument and stops descendants on timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-hook-"));
    try {
      await writeFile(join(root, "hook"), "#!/bin/sh\nprintf '%s\\n' \"$1\" \"$FORGERIE_WORKTREE_PATH\" \"$PWD\"\nsleep 30\n", { mode: 0o755 });
      const target = "/path with 'quotes' and spaces";
      const result = await runWorktreeHook({ repo: root, relativePath: "hook", target, cwd: root, timeoutMs: 100 });
      expect(result.exitCode).toBe(124);
      expect(result.log).toContain(`${target}\n${target}\n${root}`);
      expect(result.log).toContain("Hook timed out");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
