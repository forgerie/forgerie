import { describe, expect, it } from "vitest";
import { entriesOf } from "./changesSource";
import { fileOrder, fileTree, foldersAbove, treeRows, treeStep, type FileTreeNode } from "./fileTree";

type State = "unmodified" | "modified" | "added" | "untracked";
const file = (path: string, index: State, workingTree: State) => ({ path, index, workingTree });
const shape = (nodes: readonly FileTreeNode[]): unknown[] =>
  nodes.map((node) => node.type === "file" ? node.name : { [node.name]: shape(node.children) });

describe("fileTree", () => {
  it("nests files under their folders, folders first, and shares a row for a folder with one folder in it", () => {
    const nodes = fileTree(entriesOf([
      file("src/auth/LoginForm.tsx", "unmodified", "modified"),
      file("src/auth/session.ts", "unmodified", "modified"),
      file("src/main.ts", "unmodified", "modified"),
      file("README.md", "unmodified", "modified"),
      file("vendor/sso-client/", "untracked", "untracked"),
    ]));
    expect(shape(nodes)).toEqual([
      { src: [{ auth: ["LoginForm.tsx", "session.ts"] }, "main.ts"] },
      { vendor: ["sso-client/"] },
      "README.md",
    ]);
    expect(shape(fileTree(entriesOf([file("a/b/c/d.ts", "unmodified", "modified")])))).toEqual([{ "a/b/c": ["d.ts"] }]);
  });

  it("puts staged changes in their own group above the rest, once some exist", () => {
    const nodes = fileTree(entriesOf([
      file("src/a.ts", "modified", "modified"),
      file("src/b.ts", "unmodified", "modified"),
    ]));
    expect(shape(nodes)).toEqual([
      { "Staged changes": [{ src: ["a.ts"] }] },
      { Changes: [{ src: ["a.ts", "b.ts"] }] },
    ]);
    expect(nodes.map((node) => node.key)).toEqual(["staged:", "unstaged:"]);
    expect(fileOrder(nodes).map((entry) => entry.key)).toEqual(["staged:src/a.ts", "unstaged:src/a.ts", "unstaged:src/b.ts"]);
  });
});

describe("tree rows and keys", () => {
  const nodes = fileTree(entriesOf([
    file("src/auth/LoginForm.tsx", "unmodified", "modified"),
    file("src/main.ts", "unmodified", "modified"),
    file("README.md", "unmodified", "modified"),
    file("vendor/sso-client/", "untracked", "untracked"),
  ]));

  it("leaves out what a collapsed folder holds, and names each row's level and folder", () => {
    expect(treeRows(nodes, new Set()).map((row) => `${String(row.level)} ${row.node.name}`))
      .toEqual(["1 src", "2 auth", "3 LoginForm.tsx", "2 main.ts", "1 vendor", "2 sso-client/", "1 README.md"]);
    expect(treeRows(nodes, new Set(["unstaged:src/"])).map((row) => row.node.name)).toEqual(["src", "vendor", "sso-client/", "README.md"]);
  });

  it("finds the folders above a file, outermost first", () => {
    expect(foldersAbove(nodes, "unstaged:src/auth/LoginForm.tsx")).toEqual(["unstaged:src/", "unstaged:src/auth/"]);
    expect(foldersAbove(nodes, "unstaged:README.md")).toEqual([]);
  });

  it("moves, folds, and opens as the ARIA tree pattern says", () => {
    const open = new Set<string>();
    const rows = treeRows(nodes, open);
    expect(treeStep(rows, 0, "ArrowDown", open)).toEqual({ type: "focus", index: 1 });
    expect(treeStep(rows, 0, "ArrowUp", open)).toBeUndefined();
    expect(treeStep(rows, 3, "End", open)).toEqual({ type: "focus", index: 6 });
    expect(treeStep(rows, 0, "ArrowLeft", open)).toEqual({ type: "fold", key: "unstaged:src/", open: false });
    expect(treeStep(rows, 0, "ArrowRight", open)).toEqual({ type: "focus", index: 1 });
    expect(treeStep(rows, 2, "ArrowLeft", open)).toEqual({ type: "focus", index: 1 });
    expect(treeStep(rows, 2, "Enter", open)).toEqual({ type: "open", key: "unstaged:src/auth/LoginForm.tsx" });
    // An untracked folder has no diff to open.
    expect(treeStep(rows, 5, "Enter", open)).toBeUndefined();
    const shut = new Set(["unstaged:src/"]);
    expect(treeStep(treeRows(nodes, shut), 0, "ArrowRight", shut)).toEqual({ type: "fold", key: "unstaged:src/", open: true });
  });
});
