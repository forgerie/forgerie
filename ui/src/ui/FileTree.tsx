import { useEffect, useMemo, useState } from "react";
import { FileIcon, FileMinusIcon, FilePenIcon, FilePlusIcon, FolderIcon, type LucideIcon } from "lucide-react";
import { countMarks, filePaths, parseFileTree, type FileMark, type FileNode } from "./markdown/richBlockSyntax";
import "./FileTree.css";

const MARK_ICONS: Record<FileMark, LucideIcon> = { added: FilePlusIcon, changed: FilePenIcon, deleted: FileMinusIcon };
const MARK_LABELS: Record<FileMark, string> = { added: "added", changed: "changed", deleted: "deleted" };
const MARK_ORDER: FileMark[] = ["added", "changed", "deleted"];
const NONE: ReadonlySet<string> = new Set();
/** How long the tree's text must stay the same before its files are looked up. A streamed block changes on every token. */
export const FILE_CHECK_DELAY_MS = 250;

/** How a tree's files become links: which of them exist, and what a tap on one does. */
export interface FileLinks {
  /** The paths, of those asked for, that name a file that exists now. */
  existing: (paths: readonly string[], signal: AbortSignal) => Promise<ReadonlySet<string>>;
  open: (path: string) => void;
}

type Props = { markLabels?: Record<FileMark, string> } & (
  | { code: string; links?: FileLinks | undefined; nodes?: undefined; base?: undefined; found?: undefined }
  | { nodes: FileNode[]; base: string; found: ReadonlySet<string>; links: FileLinks | undefined; code?: undefined });

/**
 * System molecule: the files a change touched, as a tree. Directories that
 * hold one directory and nothing else fold into one row, so a deep path does
 * not push its files off a narrow column. Nested levels render through this
 * same component. With `links`, a file opens on a tap once `existing` says it
 * is there; any other row stays plain.
 */
export function FileTree({ code, nodes, base = "", found: given, links, markLabels = MARK_LABELS }: Props) {
  const tree = useMemo(() => nodes ?? parseFileTree(code), [nodes, code]);
  const [checked, setChecked] = useState<{ key: string; found: ReadonlySet<string> }>();
  // Only the top of the tree looks files up; nested levels get what it found.
  const wanted = useMemo(() => nodes === undefined && links ? filePaths(tree) : [], [nodes, links, tree]);
  const key = wanted.join("\n");
  useEffect(() => {
    if (!links || key === "") return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      links.existing(key.split("\n"), controller.signal).then(
        (existing) => { if (!controller.signal.aborted) setChecked({ key, found: existing }); },
        () => undefined);
    }, FILE_CHECK_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [links, key]);
  const found = given ?? (checked?.key === key ? checked.found : NONE);

  if (tree.length === 0) return null;
  const list = <ul className="path-tree-list" role="list">
    {tree.map((node, index) => {
      const Icon = node.directory ? FolderIcon : node.mark ? MARK_ICONS[node.mark] : FileIcon;
      const path = `${base}${node.name}${node.directory ? "/" : ""}`;
      const label = <>
        <Icon className="path-tree-icon" {...(node.mark ? { role: "img", "aria-label": markLabels[node.mark] } : { "aria-hidden": true })} />
        <span className="path-tree-name">{node.directory ? `${node.name}/` : node.name}</span>
      </>;
      return <li key={`${node.name}-${index}`} className="path-tree-item">
        <span className="path-tree-row" data-mark={node.mark}>
          {links && found.has(path) ? <button type="button" className="path-tree-open" title={path} onClick={() => links.open(path)}>{label}</button> : label}
          {node.note !== "" && <span className="path-tree-note">{node.note}</span>}
        </span>
        {node.children.length > 0 && <FileTree nodes={node.children} base={path} found={found} links={links} markLabels={markLabels} />}
      </li>;
    })}
  </ul>;
  if (nodes !== undefined) return list;
  const counts = countMarks(tree);
  const summary = MARK_ORDER.filter((mark) => counts[mark] > 0).map((mark) => `${counts[mark]} ${markLabels[mark]}`).join(", ");
  return <div className="path-tree">
    {summary !== "" && <div className="path-tree-summary">{summary}</div>}
    {list}
  </div>;
}
