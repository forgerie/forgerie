import { describe, expect, it, vi } from "vitest";
import { createDraftStore } from "../draftStore";
import { createNoteTray } from "./noteTray";
import type { DiffNote } from "./diffNotes";

const note = (id: string): DiffNote => ({ id, path: "src/a.ts", staged: false, comment: `Note ${id}`, lines: [{ kind: "add", newLineNumber: 1, text: "x" }] });
function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); }, items };
}

describe("note tray", () => {
  it("adds, edits, and removes notes, and tells subscribers each time", () => {
    const tray = createNoteTray();
    const listener = vi.fn();
    tray.subscribe(listener);
    tray.add(note("a"));
    tray.add(note("b"));
    tray.edit("a", "Changed");
    tray.remove("b");
    expect(tray.notes()).toEqual([{ ...note("a"), comment: "Changed" }]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("drops only the notes a message carried, so a note added during the send waits for the next one", () => {
    const tray = createNoteTray();
    tray.add(note("a"));
    const carried = tray.notes().map((item) => item.id);
    tray.add(note("b"));
    tray.drop(carried);
    expect(tray.notes().map((item) => item.id)).toEqual(["b"]);
  });

  it("outlives a reload in the session's draft, next to the chat text and without touching it", () => {
    const storage = memoryStorage();
    const drafts = createDraftStore(storage);
    drafts.session("s").saveChat("half typed");
    createNoteTray(drafts.session("s")).add(note("a"));
    const reloaded = createDraftStore(storage).session("s");
    expect(createNoteTray(reloaded).notes()).toEqual([note("a")]);
    expect(reloaded.chat()).toBe("half typed");
    // An ask's answers come and go without costing the notes.
    reloaded.saveAnswers("ask-1", { index: 1, drafts: {} });
    reloaded.keepAnswers(undefined);
    expect(reloaded.notes()).toEqual([note("a")]);
    createNoteTray(reloaded).remove("a");
    reloaded.saveChat("");
    expect(storage.items.size).toBe(0);
  });

  it("ignores a damaged saved note list instead of losing the chat draft", () => {
    const storage = memoryStorage();
    storage.setItem("forgerie.draft.v1:s", JSON.stringify({ chat: "kept", notes: [{ id: "x", path: "../secret" }] }));
    const drafts = createDraftStore(storage).session("s");
    expect(drafts.notes()).toEqual([]);
    expect(drafts.chat()).toBe("kept");
  });
});
