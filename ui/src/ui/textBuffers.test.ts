import { describe, expect, it } from "vitest";
import { dirtyPaths, edited, isDirty, opened, savePlan, saving, settled, type FileBuffer } from "./textBuffers";

const text = (value: string, version = "v1") => opened(undefined, { type: "text", path: "a.ts", text: value, version });

describe("text buffers", () => {
  it("opens text clean, and counts each read so a reload gives the editor a new document", () => {
    const first = text("a\n");
    const again = opened(edited(first, "b\n"), { type: "text", path: "a.ts", text: "c\n", version: "v2" });
    expect(first).toMatchObject({ type: "open", base: "a\n", text: "a\n", opened: 1, save: { type: "idle" } });
    expect(again).toMatchObject({ base: "c\n", text: "c\n", version: "v2", opened: 2 });
    expect(isDirty(first)).toBe(false);
  });

  it("opens a file that cannot be saved back unchanged as locked", () => {
    expect(opened(undefined, { type: "locked", path: "a.bin", reason: "binary", size: 9 })).toEqual({ type: "locked", reason: "binary", size: 9 });
  });

  it("edits with \\n between lines and saves with the file's own CRLF", () => {
    const buffer = edited(text("one\r\ntwo\r\n"), "one\nTWO\n");
    expect(buffer).toMatchObject({ base: "one\ntwo\n", separator: "\r\n" });
    expect(savePlan(buffer)).toEqual({ text: "one\nTWO\n", disk: "one\r\nTWO\r\n", expected: { type: "version", version: "v1" } });
  });

  it("starts no save for a clean buffer, a save on the way, or a conflict the reader has not answered", () => {
    const dirty = edited(text("a"), "b");
    const conflicted = settled(saving(dirty, "b"), { type: "conflict", version: "v9" });
    expect(savePlan(text("a"))).toBeUndefined();
    expect(savePlan(saving(dirty, "b"))).toBeUndefined();
    expect(savePlan(conflicted)).toBeUndefined();
  });

  it("overwrites a conflict against what the disk holds now, or only where the file is still gone", () => {
    const dirty = edited(text("a"), "b");
    const changed = settled(saving(dirty, "b"), { type: "conflict", version: "v9" });
    const deleted = settled(saving(dirty, "b"), { type: "conflict", version: undefined });
    expect(savePlan(changed, true)?.expected).toEqual({ type: "version", version: "v9" });
    expect(savePlan(deleted, true)?.expected).toEqual({ type: "absent" });
  });

  it("keeps text typed while a save was on the way as an edit the disk lacks", () => {
    const sent = saving(edited(text("a"), "ab"), "ab");
    const done = settled(edited(sent, "abc"), { type: "saved", version: "v2" });
    expect(done).toMatchObject({ base: "ab", text: "abc", version: "v2", save: { type: "idle" } });
    expect(isDirty(done)).toBe(true);
  });

  it("says saved until the next keystroke", () => {
    const done = settled(saving(edited(text("a"), "b"), "b"), { type: "saved", version: "v2" });
    expect(done).toMatchObject({ save: { type: "saved" } });
    expect(edited(done, "bc")).toMatchObject({ save: { type: "idle" } });
  });

  it("holds a failed save until the next one", () => {
    const failed = settled(saving(edited(text("a"), "b"), "b"), { type: "failed", message: "Disk full" });
    expect(edited(failed, "bc")).toMatchObject({ save: { type: "failed", message: "Disk full" } });
    expect(savePlan(failed)?.text).toBe("b");
  });

  it("lists the paths with unsaved edits in path order", () => {
    const buffers: Record<string, FileBuffer> = { "z.ts": edited(text("a"), "b"), "a.ts": edited(text("a"), "c"), "m.ts": text("a"), "x.bin": { type: "loading" } };
    expect(dirtyPaths(buffers)).toEqual(["a.ts", "z.ts"]);
  });
});
