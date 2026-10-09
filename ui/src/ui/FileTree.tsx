import { FileIcon, FileMinusIcon, FilePenIcon, FilePlusIcon, FolderIcon, type LucideIcon } from "lucide-react";
import { countMarks, parseFileTree, type FileMark, type FileNode } from "./markdown/richBlockSyntax";
import "./FileTree.css";

const MARK_ICONS: Record<FileMark, LucideIcon> = { added: FilePlusIcon, changed: FilePenIcon, deleted: FileMinusIcon };
const MARK_LABELS: Record<FileMark, string> = { added: "added", changed: "changed", deleted: "deleted" };
const MARK_ORDER: FileMark[] = ["added", "changed", "deleted"];

type Props = { markLabels?: Record<FileMark, string> } & ({ code: string; nodes?: undefined } | { nodes: FileNode[]; code?: undefined });

/**
 * System molecule: the files a change touched, as a tree. Directories that
 * hold one directory and nothing else fold into one row, so a deep path does
 * not push its files off a narrow column. Nested levels render through this
 * same component.
 */
export function FileTree({ code, nodes, markLabels = MARK_LABELS }: Props) {
  const tree = nodes ?? parseFileTree(code);
  if (tree.length === 0) return null;
  const list = <ul className="path-tree-list" role="list">
    {tree.map((node, index) => {
      const Icon = node.directory ? FolderIcon : node.mark ? MARK_ICONS[node.mark] : FileIcon;
      return <li key={`${node.name}-${index}`} className="path-tree-item">
        <span className="path-tree-row" data-mark={node.mark}>
          <Icon className="path-tree-icon" {...(node.mark ? { role: "img", "aria-label": markLabels[node.mark] } : { "aria-hidden": true })} />
          <span className="path-tree-name">{node.directory ? `${node.name}/` : node.name}</span>
          {node.note !== "" && <span className="path-tree-note">{node.note}</span>}
        </span>
        {node.children.length > 0 && <FileTree nodes={node.children} markLabels={markLabels} />}
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
