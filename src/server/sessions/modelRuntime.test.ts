import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelRuntimeForAgentDir } from "./modelRuntime.js";
const tempDirs: string[] = [];
beforeEach(() => { vi.stubEnv("PI_OFFLINE", "1"); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("createModelRuntimeForAgentDir", () => {
  it("loads stored credentials from the selected profile without changing them", async () => {
    const agentDir = await tempAgentDir();
    const authPath = join(agentDir, "auth.json");
    const credentials = JSON.stringify({ anthropic: { type: "api_key", key: "profile-test-key" } });
    await writeFile(authPath, credentials);

    const runtime = await createModelRuntimeForAgentDir(agentDir);

    expect(runtime.hasConfiguredAuth("anthropic")).toBe(true);
    expect(await readFile(authPath, "utf8")).toBe(credentials);
  });

  it("keeps runtime-owned refreshes local so request paths cannot stall", async () => {
    // Pi 0.84 synchronizes only the changed provider and fixes allowNetwork to
    // false. A throwing global refresh proves credential mutation no longer
    // reaches that unbounded path.
    vi.stubEnv("PI_OFFLINE", undefined);
    const agentDir = await tempAgentDir();
    const runtime = await createModelRuntimeForAgentDir(agentDir);
    const refresh = vi.spyOn(runtime, "refresh").mockRejectedValue(new Error("global refresh must not run"));

    await expect(runtime.removeRuntimeApiKey("anthropic")).resolves.toBeUndefined();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("restores a previously set PI_OFFLINE after runtime creation", async () => {
    // The file-level beforeEach stubs PI_OFFLINE=1.
    const agentDir = await tempAgentDir();
    await createModelRuntimeForAgentDir(agentDir);
    expect(process.env["PI_OFFLINE"]).toBe("1");
  });

  it("restores a previously unset PI_OFFLINE after runtime creation", async () => {
    vi.unstubAllEnvs();
    const previous = process.env["PI_OFFLINE"];
    delete process.env["PI_OFFLINE"];
    try {
      const agentDir = await tempAgentDir();
      const runtime = await createModelRuntimeForAgentDir(agentDir);
      const refresh = vi.spyOn(runtime, "refresh").mockRejectedValue(new Error("global refresh must not run"));

      await expect(runtime.removeRuntimeApiKey("anthropic")).resolves.toBeUndefined();

      expect(refresh).not.toHaveBeenCalled();
      expect(process.env["PI_OFFLINE"]).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env["PI_OFFLINE"] = previous;
    }
  });

  it("restores PI_OFFLINE when creations overlap, because the env windows are serialized", async () => {
    vi.unstubAllEnvs();
    const previous = process.env["PI_OFFLINE"];
    delete process.env["PI_OFFLINE"];
    try {
      const dirs = await Promise.all([tempAgentDir(), tempAgentDir(), tempAgentDir()]);
      const runtimes = await Promise.all(dirs.map((dir) => createModelRuntimeForAgentDir(dir)));

      // Interleaved save/restore pairs would leave PI_OFFLINE set process-wide.
      expect(process.env["PI_OFFLINE"]).toBeUndefined();
      for (const runtime of runtimes) {
        const refresh = vi.spyOn(runtime, "refresh").mockRejectedValue(new Error("global refresh must not run"));
        await expect(runtime.removeRuntimeApiKey("anthropic")).resolves.toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
      }
    } finally {
      if (previous !== undefined) process.env["PI_OFFLINE"] = previous;
    }
  });
});

async function tempAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-model-runtime-"));
  tempDirs.push(dir);
  return dir;
}
