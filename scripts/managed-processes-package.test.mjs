import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dependencyName = "@aliou/pi-processes";
const dependencyPath = "file:vendor/pi-processes/aliou-pi-processes-0.10.4-forgerie.1.tgz";

describe("bundled managed processes package", () => {
  it("declares the patched package as a shipped Forgerie dependency", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));

    expect(packageJson.dependencies?.[dependencyName]).toBe(dependencyPath);
    expect(packageJson.bundleDependencies).toContain(dependencyName);
    expect(packageJson.files).toContain("vendor");
  });

  it("installs the two Forgerie protocol patches from the bundled archive", async () => {
    const packageRoot = join(repoRoot, "node_modules", "@aliou", "pi-processes");
    const [executor, channels, handler] = await Promise.all([
      readFile(join(packageRoot, "src", "utils", "command-executor.ts"), "utf8"),
      readFile(join(packageRoot, "src", "protocol", "channels.ts"), "utf8"),
      readFile(join(packageRoot, "extensions", "processes", "handlers", "commands.ts"), "utf8"),
    ]);

    expect(executor).toContain('spawn(shellExecutable, ["-c", command]');
    expect(executor).not.toContain('spawn(shellExecutable, ["-lc", command]');
    expect(executor).toContain("Configured shell");
    expect(channels).toContain('COMMAND_WRITE: "processes:command:write"');
    expect(handler).toContain("manager.writeToStdin(command.id, command.input");
  });
});
