import { expect, it } from "vitest";
import { createProcessesStore } from "./processesStore";

const snapshot = { available: true, writeSupported: true, processes: [{ id: "one", name: "Reader", pid: 0, command: "cat", cwd: "/project", startTime: 1, endTime: null,
  status: "running", exitCode: null, success: null, endReason: null, signal: null, errorMessage: null, supervision: "attached", notice: "ends when Forgerie restarts" }] };
it("refreshes the session projection and output, and submits Stop and exact stdin", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const store = createProcessesStore(async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(init.method === "POST" ? { ok: true, bytesWritten: 6 } : url.includes("/output?") ? { ok: true, lines: [{ type: "stdout", text: "hello" }] } : snapshot);
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    store.refresh(); await expect.poll(() => store.getSnapshot().view.kind).toBe("ready");
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("hello");
    expect(await store.write("one", "hello\n", true)).toEqual({ ok: true, bytesWritten: 6 });
    store.stop("one");
    await expect.poll(() => calls.some(call => call.url.endsWith("/kill"))).toBe(true);
    expect(calls).toContainEqual({ url: "/api/sessions/session/processes/one/write", body: { cwd: "/project", input: "hello\n", end: true } });
  } finally { store.dispose(); }
});
it("reports partial writes with the exact byte count and does not retry writes", async () => {
  let writes = 0;
  const store = createProcessesStore(async (_url, init) => {
    if (init.method === "POST") { writes++; return Response.json({ ok: false, reason: "stdin_full", bytesWritten: 4096 }); }
    return Response.json(snapshot);
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    expect(await store.write("one", "x".repeat(5000))).toEqual({ ok: false, reason: "write_error", bytesWritten: 4096 });
    expect(store.getSnapshot().error).toContain("4096 bytes written"); expect(writes).toBe(1);
  } finally { store.dispose(); }
});
it("surfaces failed reads and retries from the same transport seam", async () => {
  let ready = false;
  const store = createProcessesStore(async () => ready ? Response.json(snapshot) : new Response("no", { status: 503 }), () => ({ id: "session", cwd: "/project" }));
  try {
    store.refresh(); await expect.poll(() => store.getSnapshot().view).toEqual({ kind: "failed", error: "HTTP 503" });
    ready = true; store.refresh(); await expect.poll(() => store.getSnapshot().view.kind).toBe("ready");
  } finally { store.dispose(); }
});
