import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = join(repoRoot, "install.sh");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe.skipIf(process.platform === "win32")("local install script", () => {
  it("installs, builds, links, and installs development services from the checkout", async () => {
    const fixture = await createFixture();

    await execUtf8("sh", [installerPath], fixture.env);

    expect((await readFile(fixture.npmArgsPath, "utf8")).trim().split("\n")).toEqual([
      "npm",
      "install",
      "npm",
      "run",
      "npm",
      "build",
      "npm",
      "link",
    ]);
    expect((await readFile(fixture.piWebArgsPath, "utf8")).trim().split("\n")).toEqual(["install", "--dev"]);
  });
});

async function createFixture(): Promise<{
  env: NodeJS.ProcessEnv;
  npmArgsPath: string;
  piWebArgsPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-install-script-"));
  tempRoots.push(root);
  const npmArgsPath = join(root, "npm-args");
  const piWebArgsPath = join(root, "forgerie-args");
  const npmPath = join(root, "npm");
  const piWebPath = join(root, "forgerie");
  await Promise.all([
    writeFile(npmPath, "#!/usr/bin/env sh\nprintf 'npm\\n%s\\n' \"$@\" >> \"$FAKE_NPM_ARGS\"\n"),
    writeFile(piWebPath, "#!/usr/bin/env sh\nprintf '%s\\n' \"$@\" > \"$FAKE_PI_WEB_ARGS\"\n"),
  ]);
  await Promise.all([chmod(npmPath, 0o755), chmod(piWebPath, 0o755)]);
  return {
    env: {
      ...process.env,
      PATH: `${root}:${process.env["PATH"] ?? ""}`,
      FAKE_NPM_ARGS: npmArgsPath,
      FAKE_PI_WEB_ARGS: piWebArgsPath,
    },
    npmArgsPath,
    piWebArgsPath,
  };
}

function execUtf8(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { env, encoding: "utf8" }, (error, stdout) => {
      if (error !== null) {
        reject(error instanceof Error ? error : new Error("Command failed"));
        return;
      }
      resolvePromise(stdout);
    });
  });
}
