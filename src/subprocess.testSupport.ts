import { spawn } from "node:child_process";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface PendingCommand {
  abort(): void;
  closed: Promise<void>;
}

/** Owns commands until close, including descendants that inherit their output pipes. */
export function createTestCommandScope(): {
  run(executable: string, args: string[], env?: NodeJS.ProcessEnv): Promise<CommandResult>;
  dispose(): Promise<void>;
} {
  const pending = new Set<PendingCommand>();
  let disposed = false;
  let disposal: Promise<void> | undefined;

  return {
    run(executable, args, env = process.env) {
      if (disposed) return Promise.reject(new Error("Test command scope is disposed"));
      const child = spawn(executable, args, { env, detached: process.platform !== "win32" });
      let stdout = "", stderr = "";
      let aborted = false;
      let spawnError: Error | undefined;
      let close: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => { close = resolve; });
      const command: PendingCommand = {
        closed,
        abort() {
          aborted = true;
          if (child.pid === undefined) return;
          try {
            // The leader can exit while a descendant still holds stdout open.
            // Do not use exitCode or child.killed to decide whether to signal the group.
            if (process.platform === "win32") child.kill("SIGKILL");
            else process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
          }
        },
      };
      pending.add(command);
      const result = new Promise<CommandResult>((resolve, reject) => {
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (data: string) => { stdout += data; });
        child.stderr.on("data", (data: string) => { stderr += data; });
        child.on("error", (error) => { spawnError = error; });
        child.once("close", (code) => {
          pending.delete(command);
          if (aborted) reject(new DOMException("Test command scope disposed", "AbortError"));
          else if (spawnError !== undefined) reject(spawnError);
          else resolve({ code, stdout, stderr });
          close();
        });
      });
      // A timed-out test may no longer await its command. Keep its rejection
      // observed without changing the promise returned to an active caller.
      void result.catch(() => undefined);
      return result;
    },
    dispose() {
      if (disposal !== undefined) return disposal;
      disposed = true;
      disposal = (async () => {
        const results = await Promise.allSettled([...pending].map(async (command) => {
          command.abort();
          await command.closed;
        }));
        const errors: unknown[] = [];
        for (const result of results) if (result.status === "rejected") errors.push(result.reason);
        if (errors.length > 0) throw new AggregateError(errors, "Could not dispose test commands");
      })();
      return disposal;
    },
  };
}
