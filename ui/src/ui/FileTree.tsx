import { useMemo } from "react";
import { FileIcon, FileMinusIcon, FilePenIcon, FilePlusIcon, FolderIcon, type LucideIcon } from "lucide-react";
import { countEntries, countMarks, filePaths, hasMarks, parseFileTree, type FileMark, type FileNode } from "./markdown/richBlockSyntax";
import { useExistingPaths, type FileLinks } from "./useExistingPaths";
import "./FileTree.css";

export { FILE_CHECK_DELAY_MS, type FileLinks } from "./useExistingPaths";

const MARK_ICONS: Record<FileMark, LucideIcon> = { added: FilePlusIcon, changed: FilePenIcon, deleted: FileMinusIcon };
const MARK_LABELS: Record<FileMark, string> = { added: "added", changed: "changed", deleted: "deleted" };
const MARK_ORDER: FileMark[] = ["added", "changed", "deleted"];

/** One row of a layout: an entry, how deep it sits, and its path from the top. */
type LayoutRow = { node: FileNode; depth: number; path: string };
function layoutRows(list: readonly FileNode[], base = "", depth = 0): LayoutRow[] {
  return list.flatMap((node) => {
    const path = `${base}${node.name}${node.directory ? "/" : ""}`;
    return [{ node, depth, path }, ...layoutRows(node.children, path, depth + 1)];
  });
}
const layoutSummary = (entries: number) => `Layout, ${entries} ${entries === 1 ? "entry" : "entries"}`;

type Props = { markLabels?: Record<FileMark, string>; layoutLabel?: (entries: number) => string } & (
  | { code: string; links?: FileLinks | undefined; nodes?: undefined; base?: undefined; found?: undefined }
  | { nodes: FileNode[]; base: string; found: ReadonlySet<string>; links: FileLinks | undefined; code?: undefined });

/**
 * System molecule: the files a change touched, as a tree. A tree with no
 * marks is a layout instead: plain icons, a count of its entries, and the
 * notes in one aligned column, because the notes are the point. Directories
 * that hold one directory and nothing else fold into one row, so a deep path
 * does not push its files off a narrow column. Nested levels render through this
 * same component. With `links`, a file opens on a tap once `existing` says it
 * is there; any other row stays plain.
 */
export function FileTree({ code, nodes, base = "", found: given, links, markLabels = MARK_LABELS, layoutLabel = layoutSummary }: Props) {
  const tree = useMemo(() => nodes ?? parseFileTree(code), [nodes, code]);
  // Only the top of the tree looks files up; nested levels get what it found.
  const wanted = useMemo(() => nodes === undefined && links ? filePaths(tree) : [], [nodes, links, tree]);
  const checked = useExistingPaths(wanted, nodes === undefined ? links : undefined);
  const found = given ?? checked;

  if (tree.length === 0) return null;
  if (nodes === undefined && !hasMarks(tree)) return <div className="path-tree">
    <div className="path-tree-summary">{layoutLabel(countEntries(tree))}</div>
    <ul className="path-tree-layout" role="list">
      {layoutRows(tree).map(({ node, depth, path }, index) => {
        const Icon = node.directory ? FolderIcon : FileIcon;
        const label = <><Icon className="path-tree-icon" aria-hidden /><span className="path-tree-name">{node.directory ? `${node.name}/` : node.name}</span></>;
        return <li key={`${path}-${index}`} className="path-tree-layout-row" style={{ "--depth": depth }}>
          <span className="path-tree-layout-name">
            {links && found.has(path) ? <button type="button" className="path-tree-open" title={path} onClick={() => links.open(path)}>{label}</button> : label}
          </span>
          {node.note !== "" && <span className="path-tree-layout-note">{node.note}</span>}
        </li>;
      })}
    </ul>
  </div>;
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
