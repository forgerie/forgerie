import { expect, it, vi } from "vitest";
import type { ManagedProcessesSnapshot } from "@shared/apiTypes";
import { createProcessesStore } from "./processesStore";
import { processOutputBatchSchema } from "./processSchemas";

const line = (number: number, text: string, type: "stdout" | "stderr" = "stdout") => ({ number, text, type, terminated: true, truncatedStart: false });
const position = (number: number) => ({ offset: number * 100, line: number + 1 });
const tail = (lines: ReturnType<typeof line>[]) => ({ ok: true, lines, cursor: position(lines.at(-1)?.number ?? 0), droppedLines: 0 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

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
    ? tail([line(1, "hello"), line(2, "warning", "stderr")]) : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("hello\nwarning");
    request.mockClear();
    store.applySnapshot(snapshot);
    expect(store.getSnapshot().selected).toBe("one");
    store.applyOutput("other", [line(3, "not selected", "stderr")], position(3));
    expect(store.getSnapshot().output).toBe("hello\nwarning");
    store.applyOutput("one", [line(3, "world"), line(4, "error", "stderr")], position(4));
    expect(store.getSnapshot().output).toBe("hello\nwarning\nworld\nerror");
    expect(store.getSnapshot().stderr).toEqual([1, 3]);
    store.applyOutput("one", [], position(4));
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
    ? tail([line(1, "discarded", "stderr"), line(2, "retained", "stderr")]) : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("discarded\nretained");
    request.mockClear();
    const lines = Array.from({ length: 199 }, (_, index) => line(index + 3, String(index), index === 198 ? "stderr" : "stdout"));
    store.applyOutput("one", lines, position(201));
    expect(store.getSnapshot().output?.split("\n")).toEqual(["retained", ...lines.map(line => line.text)]);
    expect(store.getSnapshot().stderr).toEqual([0, 199]);
    store.applyOutput("one", [...lines.map(item => ({ ...item, number: item.number + 199 })), ...lines.map(item => ({ ...item, number: item.number + 398 }))], position(599));
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
  store.applyOutput("one", [line(1, "")], position(1));
  store.applyOutput("one", [line(2, "", "stderr"), line(3, "after blanks")], position(3));
  expect(store.getSnapshot().output).toBe("\n\nafter blanks");
  expect(store.getSnapshot().stderr).toEqual([1]);
  store.dispose();
  const before = store.getSnapshot();
  store.applySnapshot({ ...snapshot, processes: [] });
  store.applyOutput("one", [line(4, "ignored")], position(4));
  expect(store.getSnapshot()).toBe(before);
  expect(request).not.toHaveBeenCalled();
});
it("does not restore output from an in-flight read after a push removes the selection", async () => {
  let release!: (response: Response) => void;
  const output = new Promise<Response>(resolve => { release = resolve; });
  const request = vi.fn(async (url: string) => url.includes("/output?") ? output : Response.json(snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    const selecting = store.select("one");
    await expect.poll(() => request.mock.calls.some(([url]) => url.includes("/output?"))).toBe(true);
    store.applySnapshot({ ...snapshot, processes: [] });
    release(Response.json({ ok: true, lines: [{ type: "stdout", text: "old output" }] }));
    await selecting;
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

for (const failure of [false, true]) it(`discards an HTTP snapshot ${failure ? "failure" : "result"} superseded by a push`, async () => {
  const read = deferred<Response>();
  const request = vi.fn(() => read.promise);
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    const refreshing = store.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    store.applySnapshot(snapshot);
    read.resolve(failure ? new Response("stale failure", { status: 503 }) : Response.json({ ...snapshot, processes: [] }));
    await refreshing;
    expect(store.getSnapshot().view).toEqual({ kind: "ready", snapshot });
    expect(store.getSnapshot().readError).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  } finally { read.resolve(Response.json(snapshot)); store.dispose(); }
});
it("merges a pushed line with an older HTTP tail without losing it", async () => {
  const read = deferred<Response>();
  const started = deferred<void>();
  const store = createProcessesStore(async url => {
    if (!url.includes("/output?")) return Response.json(snapshot);
    started.resolve(); return read.promise;
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await started.promise;
    store.applyOutput("one", [line(2, "live", "stderr")], position(2));
    read.resolve(Response.json(tail([line(1, "history")])));
    await expect.poll(() => store.getSnapshot().output).toBe("history\nlive");
    expect(store.getSnapshot().stderr).toEqual([1]);
  } finally { read.resolve(Response.json(tail([]))); store.dispose(); }
});
it("deduplicates overlap by position but retains identical text at distinct positions", async () => {
  const request = vi.fn(async url => Response.json(url.includes("/output?") ? tail([line(1, "hello")]) : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("hello");
    request.mockClear();
    store.applyOutput("one", [line(1, "hello")], position(1));
    expect(store.getSnapshot().output).toBe("hello");
    store.applyOutput("one", [line(1, "hello"), line(2, "hello")], position(2));
    expect(store.getSnapshot().output).toBe("hello\nhello");
    expect(request).not.toHaveBeenCalled();
  } finally { store.dispose(); }
});
it("uses HTTP refresh, not text append, for legacy unpositioned output", async () => {
  let lines = [line(1, "hello")];
  const request = vi.fn(async url => Response.json(url.includes("/output?") ? { ok: true, lines: lines.map(({ type, text }) => ({ type, text })) } : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await expect.poll(() => store.getSnapshot().output).toBe("hello");
    request.mockClear();
    lines = [line(1, "hello"), line(2, "hello")];
    store.applyOutput("one", [{ type: "stdout", text: "hello" }]);
    await expect.poll(() => store.getSnapshot().output).toBe("hello\nhello");
    expect(request.mock.calls.filter(([url]) => url.includes("/output?"))).toHaveLength(1);
  } finally { store.dispose(); }
});

it("loads selected output even when a pushed snapshot supersedes the list read", async () => {
  const read = deferred<Response>();
  const request = vi.fn(async (url: string) => url.includes("/output?") ? Response.json(tail([line(1, "history")])) : read.promise);
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    store.applySnapshot(snapshot);
    const selecting = store.select("one");
    store.applySnapshot(snapshot);
    read.resolve(Response.json({ ...snapshot, processes: [] }));
    await selecting;
    expect(store.getSnapshot().selected).toBe("one");
    expect(store.getSnapshot().output).toBe("history");
  } finally { read.resolve(Response.json(snapshot)); store.dispose(); }
});
it("reports a selected-output failure after a snapshot-only push retains the selection", async () => {
  const read = deferred<Response>();
  const started = deferred<void>();
  const request = vi.fn(async (url: string) => {
    if (!url.includes("/output?")) return Response.json(snapshot);
    started.resolve(); return read.promise;
  });
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    const selecting = store.select("one"); await started.promise;
    store.applySnapshot(snapshot);
    read.reject(new Error("Output unavailable"));
    await selecting;
    expect(store.getSnapshot().view).toEqual({ kind: "ready", snapshot });
    expect(store.getSnapshot().selected).toBe("one");
    expect(store.getSnapshot().output).toBeUndefined();
    expect(store.getSnapshot().readError).toBe("Output unavailable");
    expect(request.mock.calls.filter(([url]) => url.includes("/output?"))).toHaveLength(1);
  } finally { read.resolve(Response.json(tail([]))); store.dispose(); }
});
it("loads selected output from a pushed snapshot after the superseded list read fails", async () => {
  const read = deferred<Response>();
  const request = vi.fn(async (url: string) => url.includes("/output?") ? Response.json(tail([line(1, "history")])) : read.promise);
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    const selecting = store.select("one");
    expect(request).toHaveBeenCalledTimes(1);
    store.applySnapshot(snapshot);
    read.resolve(new Response("Old list unavailable", { status: 503 }));
    await selecting;
    expect(store.getSnapshot().view).toEqual({ kind: "ready", snapshot });
    expect(store.getSnapshot().selected).toBe("one");
    expect(store.getSnapshot().output).toBe("history");
    expect(store.getSnapshot().readError).toBeUndefined();
    expect(request.mock.calls.filter(([url]) => url.includes("/output?"))).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  } finally { read.resolve(Response.json(snapshot)); store.dispose(); }
});
it("ignores a tail failure superseded by pushed output", async () => {
  const read = deferred<Response>();
  const started = deferred<void>();
  const store = createProcessesStore(async url => {
    if (!url.includes("/output?")) return Response.json(snapshot);
    started.resolve(); return read.promise;
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    const selecting = store.select("one"); await started.promise;
    store.applyOutput("one", [line(2, "live")], position(2));
    read.reject(new Error("old tail failure"));
    await selecting;
    expect(store.getSnapshot().output).toBe("live");
    expect(store.getSnapshot().readError).toBeUndefined();
  } finally { read.resolve(Response.json(tail([]))); store.dispose(); }
});
it("keeps a contiguous suffix across dropped batches and an authoritative clipped HTTP tail", async () => {
  let batch = tail([line(1, "old"), line(2, "old too")]);
  const store = createProcessesStore(async url => Response.json(url.includes("/output?") ? batch : snapshot), () => ({ id: "session", cwd: "/project" }));
  try {
    await store.select("one");
    batch = tail([{ ...line(5, "retained suffix", "stderr"), truncatedStart: true }, line(6, "six")]);
    store.applyOutput("one", batch.lines, position(6), 2);
    await expect.poll(() => store.getSnapshot().output).toBe("retained suffix\nsix");
    expect(store.getSnapshot().stderr).toEqual([0]);
    // The explicit tail, not an earlier browser buffer, owns the historical range.
    batch = tail([{ ...line(6, "six"), truncatedStart: true }]);
    await store.refresh();
    expect(store.getSnapshot().output).toBe("six");
    store.applyOutput("one", [], position(7), 1);
    expect(store.getSnapshot().output).toBe("");
    expect(store.getSnapshot().stderr).toEqual([]);
    // A late older polling batch must not resurrect lines dropped from the current tail.
    store.applyOutput("one", [line(6, "six")], position(6));
    expect(store.getSnapshot().output).toBe("");
  } finally { store.dispose(); }
});
it("keeps the full known line when a newer transport batch clips the same position", async () => {
  const store = createProcessesStore(async url => Response.json(url.includes("/output?") ? tail([line(1, "full line")]) : snapshot), () => ({ id: "session", cwd: "/project" }));
  try {
    await store.select("one");
    store.applyOutput("one", [{ ...line(1, "line"), truncatedStart: true }, line(2, "new")], position(2));
    expect(store.getSnapshot().output).toBe("full line\nnew");
  } finally { store.dispose(); }
});
for (const change of ["selection", "session", "dispose"] as const) it(`isolates an in-flight output read after ${change}`, async () => {
  const read = deferred<Response>();
  const started = deferred<void>();
  let session = { id: "session", cwd: "/project" };
  const first = snapshot.processes[0]; if (first === undefined) throw new Error("Missing process fixture");
  const projection = { ...snapshot, processes: [...snapshot.processes, { ...first, id: "two" }] };
  let outputReads = 0;
  const store = createProcessesStore(async url => {
    if (!url.includes("/output?")) return Response.json(projection);
    if (outputReads++ === 0) { started.resolve(); return read.promise; }
    return Response.json(tail([line(1, "fresh")]));
  }, () => session);
  const observed: (string | undefined)[] = [];
  const unsubscribe = store.subscribe(() => observed.push(store.getSnapshot().output));
  try {
    const selecting = store.select("one"); await started.promise;
    if (change === "dispose") store.dispose();
    else {
      if (change === "session") { session = { ...session, id: "other-session" }; store.applySnapshot(projection); }
      store.select(change === "selection" ? "two" : "one");
      store.applyOutput(change === "selection" ? "two" : "one", [line(1, "fresh")], position(1));
    }
    const before = store.getSnapshot();
    read.resolve(Response.json(tail([line(1, "wrong scope")])));
    await selecting;
    expect(observed).not.toContain("wrong scope");
    if (change === "dispose") expect(store.getSnapshot()).toBe(before);
    else expect(store.getSnapshot().output).toBe("fresh");
  } finally { read.resolve(Response.json(tail([]))); unsubscribe(); store.dispose(); }
});
it("rejects invalid, unsafe and unordered absolute positions at the transport boundary", () => {
  expect(processOutputBatchSchema.safeParse(tail([line(1, "valid")])).success).toBe(true);
  for (const invalid of [
    { lines: [line(0, "invalid")], cursor: position(1) },
    { lines: [line(Number.MAX_SAFE_INTEGER + 1, "unsafe")] },
    { lines: [line(1, "past cursor")], cursor: { offset: 10, line: 1 } },
    { lines: [line(2, "reversed"), line(1, "reversed")], cursor: position(2) },
    { lines: [], cursor: { offset: -1, line: 1 } },
    { lines: [], cursor: { offset: 0, line: 0 } },
  ]) expect(processOutputBatchSchema.safeParse(invalid).success).toBe(false);
});

it("heals a missing positioned push from the authoritative log instead of hiding the gap", async () => {
  let batch = tail([line(1, "hello")]);
  const request = vi.fn(async (url: string) => Response.json(url.includes("/output?") ? batch : snapshot));
  const store = createProcessesStore(request, () => ({ id: "session", cwd: "/project" }));
  try {
    await store.select("one");
    batch = tail([line(1, "hello"), line(2, "missed"), line(3, "hello")]);
    store.applyOutput("one", [line(3, "hello")], position(3));
    await expect.poll(() => store.getSnapshot().output).toBe("hello\nmissed\nhello");
    expect(request.mock.calls.filter(([url]) => url.includes("/output?"))).toHaveLength(2);
  } finally { store.dispose(); }
});
it("re-reads a stale HTTP cut when a live batch beyond it reveals a gap", async () => {
  const old = deferred<Response>();
  const started = deferred<void>();
  let reads = 0;
  const store = createProcessesStore(async url => {
    if (!url.includes("/output?")) return Response.json(snapshot);
    if (reads++ === 0) { started.resolve(); return old.promise; }
    return Response.json(tail([line(1, "history"), line(2, "missed"), line(3, "live")]));
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await started.promise;
    store.applyOutput("one", [line(3, "live")], position(3));
    old.resolve(Response.json(tail([line(1, "history")])));
    await expect.poll(() => store.getSnapshot().output).toBe("history\nmissed\nlive");
    expect(reads).toBe(2);
  } finally { old.resolve(Response.json(tail([]))); store.dispose(); }
});
it("does not apply a stale legacy HTTP tail when an unpositioned push asks for a new read", async () => {
  const old = deferred<Response>();
  const started = deferred<void>();
  let reads = 0;
  const store = createProcessesStore(async url => {
    if (!url.includes("/output?")) return Response.json(snapshot);
    if (reads++ === 0) { started.resolve(); return old.promise; }
    return Response.json({ ok: true, lines: [{ type: "stdout", text: "hello" }, { type: "stdout", text: "new" }] });
  }, () => ({ id: "session", cwd: "/project" }));
  try {
    store.select("one"); await started.promise;
    store.applyOutput("one", [{ type: "stdout", text: "new" }]);
    old.resolve(Response.json({ ok: true, lines: [{ type: "stdout", text: "hello" }] }));
    await expect.poll(() => store.getSnapshot().output).toBe("hello\nnew");
    expect(reads).toBe(2);
  } finally { old.resolve(Response.json(tail([]))); store.dispose(); }
});
