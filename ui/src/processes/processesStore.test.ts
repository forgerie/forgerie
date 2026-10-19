import { expect, it, vi } from "vitest";
import type { ManagedProcessLogLine, ManagedProcessesSnapshot } from "@shared/apiTypes";
import { createProcessesStore } from "./processesStore";

const snapshot: ManagedProcessesSnapshot = { available: true, writeSupported: true, processes: [{ id: "one", name: "Reader", pid: 0, command: "cat", cwd: "/project", startTime: 1, endTime: null,
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
it("preserves nullable and bounded tail metadata from the server projection", async () => {
  const store = createProcessesStore(async () => Response.json({ ...snapshot, processes: [
    { ...snapshot.processes[0], lastLogLine: { text: "latest", truncatedStart: true } },
    { ...snapshot.processes[0], id: "empty", lastLogLine: null },
  ] }), () => ({ id: "session", cwd: "/project" }));
  try {
    store.refresh();
    await expect.poll(() => store.getSnapshot().view.kind).toBe("ready");
    const view = store.getSnapshot().view;
    if (view.kind !== "ready") throw new Error("Expected ready projection");
    expect(view.snapshot.processes.map(item => item.lastLogLine)).toEqual([{ text: "latest", truncatedStart: true }, null]);
  } finally { store.dispose(); }
});
it("applies pushed snapshots without requesting HTTP and clears a previous read error", async () => {
  const request = vi.fn(async () => new Response("no", { status: 503 }));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.applySnapshot(snapshot);
    expect(store.getSnapshot().view).toEqual({ kind: "ready", snapshot });
    expect(request).not.toHaveBeenCalled();
    store.refresh();
    await expect.poll(() => store.getSnapshot().readError).toBe("HTTP 503");
    request.mockClear();
    const next = { ...snapshot, processes: snapshot.processes.map(process => ({ ...process, lastLogLine: { text: "new tail", truncatedStart: false } })) };
    store.applySnapshot(next);
    expect(store.getSnapshot().view).toEqual({ kind: "ready", snapshot: next });
    expect(store.getSnapshot().readError).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  } finally { store.dispose(); }
});
it("appends pushed output only for the selected process without requesting HTTP", async () => {
  const request = vi.fn(async (url: string) => Response.json(url.includes("/output?")
    ? { ok: true, lines: [{ type: "stdout", text: "hello" }, { type: "stderr", text: "warning" }] } : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("hello\nwarning");
    request.mockClear();
    store.applySnapshot(snapshot);
    expect(store.getSnapshot().selected).toBe("one");
    store.applyOutput("other", [{ type: "stderr", text: "not selected" }]);
    expect(store.getSnapshot().output).toBe("hello\nwarning");
    store.applyOutput("one", [{ type: "stdout", text: "world" }, { type: "stderr", text: "error" }]);
    expect(store.getSnapshot().output).toBe("hello\nwarning\nworld\nerror");
    expect(store.getSnapshot().stderr).toEqual([1, 3]);
    store.applyOutput("one", []);
    expect(store.getSnapshot().output).toBe("hello\nwarning\nworld\nerror");
    store.applySnapshot({ ...snapshot, processes: [] });
    expect(store.getSnapshot().selected).toBeUndefined();
    expect(store.getSnapshot().output).toBeUndefined();
    expect(store.getSnapshot().stderr).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  } finally { store.dispose(); }
});
it("keeps only the newest 200 pushed lines and rebases stderr indexes", async () => {
  const request = vi.fn(async (url: string) => Response.json(url.includes("/output?")
    ? { ok: true, lines: [{ type: "stderr", text: "discarded" }, { type: "stderr", text: "retained" }] } : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("discarded\nretained");
    request.mockClear();
    const lines: ManagedProcessLogLine[] = Array.from({ length: 199 }, (_, index) => ({ type: index === 198 ? "stderr" : "stdout", text: String(index) }));
    store.applyOutput("one", lines);
    expect(store.getSnapshot().output?.split("\n")).toEqual(["retained", ...lines.map(line => line.text)]);
    expect(store.getSnapshot().stderr).toEqual([0, 199]);
    store.applyOutput("one", lines.concat(lines));
    expect(store.getSnapshot().output?.split("\n")).toHaveLength(200);
    expect(store.getSnapshot().stderr).toEqual([0, 199]);
    expect(request).not.toHaveBeenCalled();
  } finally { store.dispose(); }
});
it("preserves blank pushed lines and ignores events after disposal", () => {
  const request = vi.fn(async () => Response.json(snapshot));
  const store = createProcessesStore(request, () => undefined);
  store.applySnapshot(snapshot);
  store.select("one");
  store.applyOutput("one", [{ type: "stdout", text: "" }]);
  store.applyOutput("one", [{ type: "stderr", text: "" }, { type: "stdout", text: "after blanks" }]);
  expect(store.getSnapshot().output).toBe("\n\nafter blanks");
  expect(store.getSnapshot().stderr).toEqual([1]);
  store.dispose();
  const before = store.getSnapshot();
  store.applySnapshot({ ...snapshot, processes: [] });
  store.applyOutput("one", [{ type: "stdout", text: "ignored" }]);
  expect(store.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});
it("does not restore output from an in-flight read after a push removes the selection", async () => {
  let release!: (response: Response) => void;
  const output = new Promise<Response>(resolve => { release = resolve; });
  const request = vi.fn(async (url: string) => url.includes("/output?") ? output : Response.json(snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one");
    await expect.poll(() => request.mock.calls.some(([url]) => url.includes("/output?"))).toBe(true);
    store.applySnapshot({ ...snapshot, processes: [] });
    release(Response.json({ ok: true, lines: [{ type: "stdout", text: "old output" }] }));
    // Let the read and its JSON decoding finish before checking that it did not restore the output.
    await output; await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().selected).toBeUndefined();
    expect(store.getSnapshot().output).toBeUndefined();
    expect(store.getSnapshot().stderr).toBeUndefined();
  } finally { release(Response.json({ ok: true, lines: [] })); store.dispose(); }
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
