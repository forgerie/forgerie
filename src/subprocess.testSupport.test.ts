import { createServer, type ServerResponse } from "node:http";
import { expect, it, onTestFinished } from "vitest";
import { createTestCommandScope } from "./subprocess.testSupport.js";

// A response holds each controlled child at a known boundary. Releasing or
// breaking the connection makes it exit, independently of the scope under test.
async function controlledChild(program: (endpoint: string) => string) {
  const scope = createTestCommandScope();
  const responses: ServerResponse[] = [];
  const pids = new Set<number>();
  let reportReady: (url: URL) => void = () => undefined;
  const ready = new Promise<URL>((resolve) => { reportReady = resolve; });
  const server = createServer((request, response) => {
    responses.push(response);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    for (const key of ["leader", "descendant"]) {
      const pid = Number(url.searchParams.get(key));
      if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
    }
    reportReady(url);
  });
  let cleanup: Promise<void> | undefined;
  const dispose = () => {
    cleanup ??= (async () => {
      // Also clean up on a test deadline or a failing assertion, even if a
      // regression in scope.dispose leaves the controlled child running.
      for (const response of responses) response.end();
      server.closeAllConnections();
      for (const pid of pids) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
      }
      await scope.dispose();
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
    })();
    return cleanup;
  };
  onTestFinished(dispose);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No child control listener");
  const result = scope.run(process.execPath, ["-e", program(`http://127.0.0.1:${String(address.port)}`)]);
  return { scope, result, ready, dispose };
}

it("retains stdout, stderr, environment and nonzero exit status for completed commands", async () => {
  const scope = createTestCommandScope();
  try {
    const result = await scope.run(process.execPath, ["-e", `
      process.stdout.write(process.env.FORGERIE_COMMAND_TEST_VALUE);
      process.stderr.write('diagnostic');
      process.exitCode = 7;
    `], { ...process.env, FORGERIE_COMMAND_TEST_VALUE: "captured" });
    expect(result).toEqual({ code: 7, stdout: "captured", stderr: "diagnostic" });
  } finally { await scope.dispose(); }
});

it("retains launch errors and can dispose a failed launch", async () => {
  const scope = createTestCommandScope();
  try {
    await expect(scope.run("/forgerie-test-command-does-not-exist", [])).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await scope.dispose(); }
});

it("aborts a running command and settles its promise before disposal returns", async () => {
  const child = await controlledChild((endpoint) => `
    process.on('SIGTERM', () => {});
    fetch(${JSON.stringify(endpoint)} + '?leader=' + process.pid)
      .then(() => process.exit(0), () => process.exit(0));
  `);
  try {
    await child.ready;
    let failure: unknown;
    void child.result.catch((error: unknown) => { failure = error; });
    const disposal = child.scope.dispose();
    expect(child.scope.dispose()).toBe(disposal);
    await disposal;
    expect(failure).toMatchObject({ name: "AbortError" });
    await expect(child.result).rejects.toMatchObject({ name: "AbortError" });
    await expect(child.scope.run(process.execPath, ["-e", "process.exit(0)"])).rejects.toThrow("disposed");
  } finally { await child.dispose(); }
});

it("can dispose a command before its spawn event", async () => {
  const scope = createTestCommandScope();
  try {
    const result = scope.run(process.execPath, ["-e", "process.stdin.resume()"]);
    await scope.dispose();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  } finally { await scope.dispose(); }
});

it("kills a descendant holding inherited stdout after its command leader has exited", async () => {
  const child = await controlledChild((endpoint) => {
    const descendant = `
      process.on('SIGTERM', () => {});
      // EOF on this private pipe proves that the leader has closed its handles.
      process.stdin.once('end', () => {
        process.stdout.write('inherited stdout is still open');
        fetch(process.argv[1] + '?leader=' + process.argv[2] + '&descendant=' + process.pid)
          .then(() => process.exit(0), () => process.exit(0));
      });
      process.stdin.resume();
    `;
    return `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, ${JSON.stringify(endpoint)}, String(process.pid)],
        { stdio: ['pipe', 'inherit', 'inherit'] });
      process.exit(0);
    `;
  });
  try {
    const ready = await child.ready;
    expect(ready.searchParams.has("descendant")).toBe(true);
    let failure: unknown;
    void child.result.catch((error: unknown) => { failure = error; });
    await child.scope.dispose();
    expect(failure).toMatchObject({ name: "AbortError" });
    await expect(child.result).rejects.toMatchObject({ name: "AbortError" });
  } finally { await child.dispose(); }
});
