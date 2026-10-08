import type { ChangeEntry } from "./changesSource";

/**
 * The changed files as a folder tree, the way an editor's source control
 * view shows them. Folders come before files, each sorted by name. A folder
 * whose only child is a folder shares its row ("src/auth"). When some files
 * are staged, two groups head the tree: staged changes, then the rest.
 */
export type FileTreeNode = FolderNode | FileNode;
export interface FolderNode { type: "folder"; key: string; name: string; children: FileTreeNode[]; group: boolean }
export interface FileNode { type: "file"; key: string; name: string; entry: ChangeEntry }

export function fileTree(entries: readonly ChangeEntry[]): FileTreeNode[] {
  const staged = entries.filter((entry) => entry.staged);
  const unstaged = entries.filter((entry) => !entry.staged);
  if (staged.length === 0) return folderNodes(unstaged, "unstaged");
  const groups: FileTreeNode[] = [{ type: "folder", key: "staged:", name: "Staged changes", group: true, children: folderNodes(staged, "staged") }];
  if (unstaged.length > 0) groups.push({ type: "folder", key: "unstaged:", name: "Changes", group: true, children: folderNodes(unstaged, "unstaged") });
  return groups;
}

interface Folder { folders: Map<string, Folder>; files: FileNode[] }
function folderNodes(entries: readonly ChangeEntry[], side: string): FileTreeNode[] {
  const root: Folder = { folders: new Map(), files: [] };
  for (const entry of entries) {
    // An untracked folder that git lists whole keeps its slash, so it reads as a folder without a diff.
    const parts = entry.path.replace(/\/$/u, "").split("/");
    const name = `${parts.pop() ?? entry.path}${entry.path.endsWith("/") ? "/" : ""}`;
    let folder = root;
    for (const part of parts) {
      let next = folder.folders.get(part);
      if (!next) { next = { folders: new Map(), files: [] }; folder.folders.set(part, next); }
      folder = next;
    }
    folder.files.push({ type: "file", key: entry.key, name, entry });
  }
  const nodes = (folder: Folder, path: string): FileTreeNode[] => [
    ...[...folder.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]): FolderNode => {
      let label = name;
      let inner = child;
      while (inner.files.length === 0 && inner.folders.size === 1) {
        const [[nextName, next]] = [...inner.folders] as [[string, Folder]];
        label = `${label}/${nextName}`;
        inner = next;
      }
      const full = `${path}${label}/`;
      return { type: "folder", key: `${side}:${full}`, name: label, group: false, children: nodes(inner, full) };
    }),
    ...folder.files.sort((a, b) => a.name.localeCompare(b.name)),
  ];
  return nodes(root, "");
}

/** Every file in the order the tree shows them, collapsed folders included. Previous and next follow this order. */
export function fileOrder(nodes: readonly FileTreeNode[]): ChangeEntry[] {
  return nodes.flatMap((node) => node.type === "file" ? [node.entry] : fileOrder(node.children));
}

/** The folders that hold a file, outermost first. Opening the file opens them. */
export function foldersAbove(nodes: readonly FileTreeNode[], fileKey: string): string[] {
  for (const node of nodes) {
    if (node.type === "file") { if (node.key === fileKey) return []; continue; }
    const below = foldersAbove(node.children, fileKey);
    if (below.length > 0 || node.children.some((child) => child.key === fileKey)) return [node.key, ...below];
  }
  return [];
}

/** A row the tree draws: nodes under a collapsed folder are left out. */
export interface TreeRow { node: FileTreeNode; level: number; parent: string | undefined }
export function treeRows(nodes: readonly FileTreeNode[], collapsed: ReadonlySet<string>, level = 1, parent?: string): TreeRow[] {
  return nodes.flatMap((node) => [
    { node, level, parent },
    ...node.type === "folder" && !collapsed.has(node.key) ? treeRows(node.children, collapsed, level + 1, node.key) : [],
  ]);
}

/** What a key does on a tree row, following the ARIA tree pattern. */
export type TreeStep =
  | { type: "focus"; index: number }
  | { type: "fold"; key: string; open: boolean }
  | { type: "open"; key: string };
export function treeStep(rows: readonly TreeRow[], index: number, key: string, collapsed: ReadonlySet<string>): TreeStep | undefined {
  const row = rows[index];
  if (!row) return undefined;
  const folder = row.node.type === "folder";
  const isOpen = folder && !collapsed.has(row.node.key);
  switch (key) {
    case "ArrowDown": return index + 1 < rows.length ? { type: "focus", index: index + 1 } : undefined;
    case "ArrowUp": return index > 0 ? { type: "focus", index: index - 1 } : undefined;
    case "Home": return { type: "focus", index: 0 };
    case "End": return { type: "focus", index: rows.length - 1 };
    case "ArrowRight":
      if (!folder) return undefined;
      return isOpen ? (rows[index + 1]?.parent === row.node.key ? { type: "focus", index: index + 1 } : undefined) : { type: "fold", key: row.node.key, open: true };
    case "ArrowLeft": {
      if (isOpen) return { type: "fold", key: row.node.key, open: false };
      const parent = rows.findIndex((item) => item.node.key === row.parent);
      return parent >= 0 ? { type: "focus", index: parent } : undefined;
    }
    case "Enter":
    case " ":
      if (folder) return { type: "fold", key: row.node.key, open: !isOpen };
      return row.node.type === "file" && row.node.entry.diffable ? { type: "open", key: row.node.key } : undefined;
    default: return undefined;
  }
}
