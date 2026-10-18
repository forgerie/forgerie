import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "./gitEnv.js";

const execute = promisify(execFile);
// Git exits 2 when the checkout has no remote named origin.
const NO_SUCH_REMOTE = 2;

/**
 * The URL of the `origin` remote, or undefined when `cwd` is not inside a git checkout
 * or the checkout has no `origin`. Any other git failure is real and still throws.
 */
export async function originRemoteUrl(cwd: string): Promise<string | undefined> {
  try {
    // LC_ALL=C keeps git's messages in English, so the not-a-repository check holds in any locale.
    const { stdout } = await execute("git", ["-C", cwd, "remote", "get-url", "origin"], { env: { ...sanitizedGitEnv(), LC_ALL: "C", LANGUAGE: "" } });
    return stdout;
  } catch (error) {
    if (isNoOrigin(error) || isNotARepository(error)) return undefined;
    throw error;
  }
}

function isNoOrigin(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === NO_SUCH_REMOTE;
}

function isNotARepository(error: unknown): boolean {
  return error instanceof Error && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("not a git repository");
}
