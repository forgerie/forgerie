import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCliEntrypoint, serviceActionArguments } from "./cli.js";

const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

function invoke(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], { encoding: "utf8", timeout: 10_000 });
}

describe("local checkout CLI", () => {
  it("lists existing-unit commands without installer commands", () => {
    const result = invoke("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Services must already exist");
    expect(result.stdout).not.toContain("forgerie install");
  });

  it("reports the installed package version without contacting a service", () => {
    const result = invoke("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(["install", "update", "uninstall"])("rejects retired %s operations", (command) => {
    const result = invoke(command);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Unknown command: ${command}`);
  });

  it("starts the daemon before the web process and stops the web process first", () => {
    expect(serviceActionArguments("start")).toEqual(["--user", "start", "forgerie-sessiond.service", "forgerie-web.service"]);
    expect(serviceActionArguments("stop")).toEqual(["--user", "stop", "forgerie-web.service", "forgerie-sessiond.service"]);
  });

  it("recognizes direct and symlinked entrypoints but rejects unrelated paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-cli-"));
    try {
      const entry = join(dir, "entry.js");
      const link = join(dir, "forgerie");
      await writeFile(entry, "");
      await symlink(entry, link);
      expect(isCliEntrypoint(entry, entry)).toBe(true);
      expect(isCliEntrypoint(link, entry)).toBe(true);
      expect(isCliEntrypoint(join(dir, "missing"), entry)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
