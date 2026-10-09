import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import "./TreeItem.css";

/** The colour of a row's mark: an editor's change letters use these. */
export type TreeItemTone = "add" | "remove" | "modify" | "conflict";

export interface TreeItemProps {
  /** Stable key of the row, on `data-row`, so the tree can find and focus it. */
  rowKey: string;
  level: number;
  /** The visible name. */
  name: string;
  /** Words a screen reader hears after the name, such as a state. */
  description?: string | undefined;
  /** `branch` opens and closes; `group` heads a list; `note` says something about its folder. */
  kind: "branch" | "group" | "leaf" | "note";
  expanded?: boolean | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  /** The one row of the tree that Tab reaches. */
  focusable: boolean;
  /** A short letter or an icon before the name, in the leading cell. */
  mark?: ReactNode;
  tone?: TreeItemTone | undefined;
  /** A count after the name, such as notes on the row. */
  count?: number | undefined;
  /** A dot after the name, such as edits not yet saved. */
  dot?: boolean | undefined;
  title?: string | undefined;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Atom: one row of an ARIA tree, indented by its level. The leading cell is a
 * chevron on a branch and a mark on a leaf, so names line up across a level.
 * Rows are as tall as a control, for a finger.
 */
export function TreeItem({ rowKey, level, name, description, kind, expanded, selected, disabled, focusable, mark, tone, count, dot, title, onActivate, onFocus, onKeyDown }: TreeItemProps) {
  const branch = kind === "branch" || kind === "group";
  return <li role="treeitem" className="tree-item" data-kind={kind} data-row={rowKey} aria-level={level} tabIndex={focusable ? 0 : -1}
    aria-label={description ? `${name}, ${description}` : name} aria-expanded={branch ? Boolean(expanded) : undefined}
    aria-selected={kind === "leaf" ? Boolean(selected) : undefined} aria-disabled={disabled || undefined} title={title}
    style={{ "--level": level }} onClick={onActivate} onFocus={onFocus} onKeyDown={onKeyDown}>
    <span className="tree-item-lead" data-tone={tone} aria-hidden="true">{branch ? <ChevronRightIcon className="tree-item-chevron" size={14} /> : mark}</span>
    <span className="tree-item-name" aria-hidden="true">{name}</span>
    {count !== undefined && count > 0 && <span className="tree-item-count" aria-hidden="true">{count}</span>}
    {dot && <span className="tree-item-dot" aria-hidden="true" />}
  </li>;
}
