import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { isNodeErrorWithCode } from "./pathSafety.js";

export const WORKTREE_PRE_REMOVE_HOOK_PATH = ".forgerie/hooks/worktree-pre-remove";
export const WORKTREE_POST_CREATE_HOOK_PATH = ".forgerie/hooks/worktree-post-create";
const LOG_LIMIT = 64 * 1024;

export async function isExecutableWorktreeHook(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; }
  catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].some((code) => isNodeErrorWithCode(error, code))) return false;
    throw error;
  }
}

interface HookOptions {
  repo: string;
  relativePath: string;
  target: string;
  cwd: string;
  onLog?: (log: string) => void;
  timeoutMs?: number;
}

/** No shell interpolation. On POSIX, the timeout stops the entire hook process group, including npm children. */
export async function runWorktreeHook(options: HookOptions): Promise<{ exitCode: number; log: string }> {
  const path = join(options.repo, options.relativePath);
  if (!await isExecutableWorktreeHook(path)) return { exitCode: 0, log: "" };
  return new Promise((resolve, reject) => {
    let log = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const grouped = process.platform !== "win32";
    const child = spawn(path, [options.target], { cwd: options.cwd, detached: grouped,
      env: { ...sanitizedGitEnv(), FORGERIE_WORKTREE_PATH: options.target, FORGERIE_REPO_PATH: options.repo } });
    const stop = (signal: NodeJS.Signals): void => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if (!isNodeErrorWithCode(error, "ESRCH")) reject(error instanceof Error ? error : new Error(String(error))); }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop("SIGTERM");
      killTimer = setTimeout(() => { stop("SIGKILL"); }, 1000);
    }, options.timeoutMs ?? 15 * 60_000);
    const clear = (): void => { clearTimeout(timer); if (killTimer !== undefined) clearTimeout(killTimer); };
    const append = (chunk: Buffer): void => { log = `${log}${chunk.toString()}`.slice(-LOG_LIMIT); options.onLog?.(log); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => { clear(); reject(error); });
    child.once("close", (code, signal) => {
      clear();
      resolve({ exitCode: timedOut ? 124 : code ?? 128,
        log: timedOut ? `${log}\nHook timed out` : signal === null ? log : `${log}\nHook stopped by ${signal}` });
    });
  });
}
