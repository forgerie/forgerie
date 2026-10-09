import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MutationError, type SessionRef } from "./catalogStore";
import { createRowActions, UNDO_MS, type SessionWrites } from "./rowActions";

const target = { id: "a", cwd: "/code/forgerie", name: "Alpha" };

/** Writes that record their calls and succeed unless told otherwise. */
function writes(failWith?: Error) {
  const calls: string[] = [];
  const act = (label: string) => async (ref: SessionRef, flag?: boolean) => {
    calls.push(`${label}:${ref.id}${flag === undefined ? "" : `:${String(flag)}`}`);
    if (failWith) throw failWith;
  };
  const api: SessionWrites = { setPinned: act("pin"), setArchived: act("archive"), deleteArchived: act("delete") };
  return { api, calls };
}
function actions(options: { failWith?: Error; copy?: boolean; onDeleted?: (id: string) => void } = {}) {
  const w = writes(options.failWith);
  const store = createRowActions({ writes: w.api, copy: () => Promise.resolve(options.copy ?? true), ...(options.onDeleted ? { onDeleted: options.onDeleted } : {}) });
  return { store, calls: w.calls };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("row actions", () => {
  it("reports whether an archive went through, for callers that move on after it", async () => {
    expect(await actions().store.archive(target)).toBe(true);
    const refused = actions({ failWith: new MutationError("Stop current session activity before archiving", 400) });
    expect(await refused.store.archive(target)).toBe(false);
    expect(refused.store.getSnapshot().toast).toEqual({ type: "error", text: "Stop current session activity before archiving" });
  });

  it("offers undo for five seconds after an archive", async () => {
    const { store, calls } = actions();
    await store.run("archive", target);
    expect(calls).toEqual(["archive:a:true"]);
    expect(store.getSnapshot().toast).toEqual({ type: "undo", target });
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(store.getSnapshot().toast?.type).toBe("undo");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().toast).toBeUndefined();
  });

  it("undo restores the archived session and closes the offer", async () => {
    const { store, calls } = actions();
    await store.run("archive", target);
    await store.undo();
    expect(calls).toEqual(["archive:a:true", "archive:a:false"]);
    expect(store.getSnapshot().toast).toBeUndefined();
  });

  it("a second archive replaces the first offer, and its full five seconds start again", async () => {
    const { store } = actions();
    await store.run("archive", target);
    vi.advanceTimersByTime(4000);
    await store.run("archive", { id: "b", cwd: "/code/forgerie", name: "Beta" });
    vi.advanceTimersByTime(4000);
    expect(store.getSnapshot().toast).toMatchObject({ type: "undo", target: { id: "b" } });
  });

  it("says the session was already deleted when undo finds nothing to restore", async () => {
    const w = writes();
    const store = createRowActions({ writes: { ...w.api, setArchived: async (_ref, archived) => { if (!archived) throw new MutationError("Session not found", 404); } }, copy: () => Promise.resolve(true) });
    await store.run("archive", target);
    await store.undo();
    expect(store.getSnapshot().toast).toEqual({ type: "error", text: "Session was already deleted" });
  });

  it("shows the server's refusal and keeps it until dismissed", async () => {
    const { store } = actions({ failWith: new MutationError("Stop current session activity before archiving", 400) });
    await store.run("archive", target);
    expect(store.getSnapshot().toast).toEqual({ type: "error", text: "Stop current session activity before archiving" });
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot().toast?.type).toBe("error");
    store.dismiss();
    expect(store.getSnapshot().toast).toBeUndefined();
  });

  it("ignores a second command on a session with a write in flight", async () => {
    let release = () => {};
    const calls: string[] = [];
    const store = createRowActions({
      writes: { setPinned: (ref) => { calls.push(ref.id); return new Promise<void>((resolve) => { release = resolve; }); }, setArchived: () => Promise.resolve(), deleteArchived: () => Promise.resolve() },
      copy: () => Promise.resolve(true),
    });
    const first = store.run("pin", target);
    expect(store.getSnapshot().pending.has("a")).toBe(true);
    await store.run("pin", target);
    release();
    await first;
    expect(calls).toEqual(["a"]);
    expect(store.getSnapshot().pending.has("a")).toBe(false);
  });

  it("tells the owner after a delete, so an open deleted session can close", async () => {
    const onDeleted = vi.fn();
    const { store, calls } = actions({ onDeleted });
    await store.run("delete", target);
    expect(calls).toEqual(["delete:a"]);
    expect(onDeleted).toHaveBeenCalledWith("a");
    expect(store.getSnapshot().toast).toEqual({ type: "info", text: "Deleted Alpha" });
  });

  it("does not report a delete the server refused", async () => {
    const onDeleted = vi.fn();
    const { store } = actions({ onDeleted, failWith: new MutationError("Archived session not found", 404) });
    await store.run("delete", target);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(store.getSnapshot().toast).toEqual({ type: "error", text: "Archived session not found" });
  });

  it("confirms a copy, and gives the path when the clipboard refuses", async () => {
    const ok = actions();
    await ok.store.run("copyPath", target);
    expect(ok.store.getSnapshot().toast).toEqual({ type: "info", text: "Copied workspace path" });
    vi.advanceTimersByTime(2499);
    expect(ok.store.getSnapshot().toast?.type).toBe("info");
    vi.advanceTimersByTime(1);
    expect(ok.store.getSnapshot().toast).toBeUndefined();
    const refused = actions({ copy: false });
    await refused.store.run("copyPath", target);
    expect(refused.store.getSnapshot().toast).toEqual({ type: "error", text: "Could not copy. The path is /code/forgerie" });
    vi.advanceTimersByTime(10000);
    expect(refused.store.getSnapshot().toast?.type).toBe("error");
  });
});
