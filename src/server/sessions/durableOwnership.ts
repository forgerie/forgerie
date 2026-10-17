import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface DurableOwnership {
  readonly databasePath: string;
  assertOwned(): void;
  release(): Promise<void>;
}

/** A kernel lock, not a PID file. Closing the owner's pipe also releases it after SIGKILL. */
export async function acquireDurableOwnership(databasePath: string): Promise<DurableOwnership> {
  const directory = dirname(resolve(databasePath));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(directory);
  const canonicalPath = await realpath(resolve(databasePath)).catch(async (error: unknown) => {
    if (!isMissing(error)) throw error;
    const existing = await lstat(databasePath).catch((failure: unknown) => { if (!isMissing(failure)) throw failure; return undefined; });
    if (existing?.isSymbolicLink() === true) throw new Error(`Durable database symlink has no target: ${databasePath}`);
    return join(canonicalDirectory, basename(databasePath));
  });
  const file = await stat(canonicalPath).catch((error: unknown) => { if (!isMissing(error)) throw error; return undefined; });
  if (file !== undefined && file.nlink !== 1) throw new Error(`Durable database must not have hard-link aliases: ${canonicalPath}`);
  // Never unlink this file: a new inode would let a second owner bypass the lock.
  const holder = spawn("flock", ["--exclusive", "--nonblock", `${canonicalPath}.lock`, "cat"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const marker = `${randomUUID()}\n`;
  let output = "";
  let errorOutput = "";
  let alive = true;
  let releasing = false;
  let failure: Error | undefined;
  const exited = new Promise<void>((resolveExit) => {
    holder.once("close", () => { alive = false; resolveExit(); });
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      failure = new Error(`Timed out acquiring Durable ownership: ${canonicalPath}`);
      holder.kill("SIGKILL");
      rejectReady(failure);
    }, 5_000);
    holder.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    holder.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output === marker) { clearTimeout(timeout); resolveReady(); }
    });
    holder.once("error", (error) => { failure = error; clearTimeout(timeout); rejectReady(error); });
    holder.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (!releasing) failure = new Error(`Durable storage ownership lost or already held: ${canonicalPath} (flock exit ${String(code)}, signal ${signal ?? "none"}) ${errorOutput.trim()}`);
      rejectReady(failure ?? new Error("Durable ownership closed before readiness"));
    });
    // flock starts cat only after acquisition. The echo proves that the kernel lock is held.
    holder.stdin.on("error", () => { /* close/error reports the acquisition failure */ });
    holder.stdin.write(marker);
  });
  return {
    databasePath: canonicalPath,
    assertOwned() {
      if (!alive || failure !== undefined || releasing) throw failure ?? new Error(`Durable storage is no longer owned: ${canonicalPath}`);
    },
    async release() {
      if (!releasing) { releasing = true; holder.stdin.end(); }
      await exited;
    },
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
