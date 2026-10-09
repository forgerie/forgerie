import { describe, expect, it } from "vitest";
import { keyStep } from "./treeKeys";
import { foldersOf, folderRows, folderStepRows, type FolderLoad } from "./lazyTree";

const ready = (entries: [string, "folder" | "file" | "link"][], truncated = false): FolderLoad =>
  ({ type: "ready", folder: { truncated, entries: entries.map(([path, type]) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), type })) } });

describe("lazy folder tree", () => {
  const folders = new Map<string, FolderLoad>([
    ["", ready([["src", "folder"], ["docs", "folder"], ["README.md", "file"], ["latest", "link"]])],
    ["src", ready([["src/ui", "folder"], ["src/main.ts", "file"]], true)],
    ["docs", { type: "failed", message: "Permission denied" }],
  ]);

  it("draws open folders' entries under them, and notes what a folder cannot show yet", () => {
    const rows = folderRows(folders, new Set(["src", "src/ui", "docs"]));
    expect(rows.map((row) => [row.type === "note" ? `(${row.note})` : row.type === "file" && row.link ? `${row.name}@` : row.type === "folder" ? `${row.name}/` : row.name, row.level])).toEqual([
      ["src/", 1], ["ui/", 2], ["(loading)", 3], ["main.ts", 2], ["(truncated)", 2], ["docs/", 1], ["(failed)", 2], ["README.md", 1], ["latest@", 1],
    ]);
    expect(rows.find((row) => row.type === "note" && row.note === "failed")).toMatchObject({ message: "Permission denied", parent: "folder:docs" });
  });

  it("leaves out the entries of a closed folder, and says when a folder is empty", () => {
    const rows = folderRows(new Map([...folders, ["src/ui", ready([])]]), new Set(["src/ui"]));
    expect(rows.map((row) => row.key)).toEqual(["folder:src", "folder:docs", "file:README.md", "file:latest"]);
    expect(folderRows(new Map([["", ready([])]]), new Set()).map((row) => row.type === "note" && row.note)).toEqual(["empty"]);
  });

  it("names the folders above a path, outermost first", () => {
    expect(foldersOf("src/ui/editor/Pane.tsx")).toEqual(["src", "src/ui", "src/ui/editor"]);
    expect(foldersOf("README.md")).toEqual([]);
  });

  it("follows the ARIA tree keys: right opens a folder, left goes to its parent, Enter opens a file or reads a failed folder again", () => {
    const open = new Set(["src", "docs"]);
    const rows = folderRows(folders, open);
    const steps = folderStepRows(rows, open);
    const index = (key: string) => rows.findIndex((row) => row.key === key);
    expect(keyStep(steps, index("folder:src/ui"), "ArrowRight")).toEqual({ type: "fold", key: "folder:src/ui", open: true });
    expect(keyStep(steps, index("file:src/main.ts"), "ArrowLeft")).toEqual({ type: "focus", index: index("folder:src") });
    expect(keyStep(steps, index("file:README.md"), "Enter")).toEqual({ type: "open", key: "file:README.md" });
    expect(keyStep(steps, index("note:failed:docs"), "Enter")).toEqual({ type: "open", key: "note:failed:docs" });
    expect(keyStep(steps, index("note:truncated:src"), "Enter")).toBeUndefined();
  });
});
