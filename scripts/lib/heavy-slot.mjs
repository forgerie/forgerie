import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Hold a project measurement slot for bounded work only (startup, build, check,
 * measurement). A separate flock process owns the lock descriptor, so servers
 * started while the slot is held never inherit it. Unrelated host units are not
 * scheduled or touched.
 */
export async function acquireHeavySlot(slot, { directory = "/tmp/forgerie-stack-latency" } = {}) {
  if (slot !== 1 && slot !== 2) throw new Error("Heavy slot must be 1 or 2");
  await mkdir(directory, { recursive: true });
  const started = performance.now();
  const lock = spawn("flock", [join(directory, `heavy-slot-${slot}.lock`), process.execPath, "-e",
    "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"], { stdio: ["pipe", "pipe", "inherit"] });
  const exited = once(lock, "exit");
  await Promise.race([
    once(lock.stdout, "data"),
    exited.then(([code]) => { throw new Error(`Heavy slot holder exited before acquisition: ${String(code)}`); }),
  ]);
  let released;
  return {
    waitMs: performance.now() - started,
    release() {
      released ??= (async () => {
        lock.stdin.end();
        const [code] = await exited;
        if (code !== 0) throw new Error(`Heavy slot holder failed: ${String(code)}`);
      })();
      return released;
    },
  };
}
