import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MenuButton, type MenuCommand } from "./MenuButton";
import "./LedgeRow.css";

/** One of a row's own actions. */
export interface LedgeAction {
  label: string;
  /** `primary`: the row's one filled action. */
  tone?: "primary" | undefined;
  /** Inline only on a row of 30rem or more; on a narrower row it leads the More menu instead. */
  wideOnly?: boolean | undefined;
  /** Hover text that says what the action does. */
  title?: string | undefined;
  disabled?: boolean | undefined;
  icon?: ReactNode;
  onPress: () => void;
}

/** The width from which a row holds its wide-only actions inline, in rem. The stylesheet's container queries use the same. */
const WIDE_REM = 30;

/**
 * Molecule: one offer in a summary list at the input, as a row. A kind word in the code face, then a title cut to one
 * line (two, under the kind, on a narrow row), and an optional second line: a gist, or why the last attempt failed in
 * the failure ink. The words are one press, such as to show the whole offer where it lives. Its actions trail the
 * words: a filled primary, outlined others, then More for the rest. On a narrow row the wide-only actions move into
 * More, and on a very narrow one the actions wrap under the words. A status, such as work in flight, takes the actions'
 * place. `even` draws every action outlined and the plain ones quiet, for a list where no row may be louder than another.
 */
export function LedgeRow({ kind, kindTone, title, onTitle, titleHint, gist, problem, status, actions = [], menu = [], menuLabel = "More", lead, even = false, anchor, children }: {
  kind: string;
  /** `live`: the kind is in the live ink, such as an offer that starts work. */
  kindTone?: "live" | undefined;
  title: string;
  /** The words' press. Absent: the words are plain text. */
  onTitle?: (() => void) | undefined;
  /** Hover text for the words' press. */
  titleHint?: string | undefined;
  /** A line about it, cut to one line. Hidden in a container under 30rem tall. */
  gist?: string | undefined;
  /** Why the last attempt failed, in the failure ink, in place of the gist. */
  problem?: string | undefined;
  /** Work in flight, in place of the actions. */
  status?: { text: string; tone?: "live" | undefined } | undefined;
  actions?: readonly LedgeAction[];
  /** The rest, behind More, after any wide-only action that has no room inline. */
  menu?: readonly (MenuCommand | "separator")[];
  menuLabel?: string;
  /** A control at the row's start, such as a count that opens a list. */
  lead?: ReactNode;
  even?: boolean;
  /** Holds the row's element, such as for a window-level panel that opens beside it. */
  anchor?: RefObject<HTMLLIElement | null> | undefined;
  /** Anything the row's actions open that draws elsewhere, such as a window-level picker. */
  children?: ReactNode;
}) {
  const own = useRef<HTMLLIElement>(null);
  const row = anchor ?? own;
  // Unmeasured, such as before layout, the row counts as wide.
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(width === 0 || width >= WIDE_REM * rem);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [row]);
  const inline = actions.filter((action) => wide || action.wideOnly !== true);
  const moved: MenuCommand[] = wide ? [] : actions.filter((action) => action.wideOnly === true)
    .map((action) => ({ label: action.label, icon: action.icon, disabled: action.disabled, onSelect: action.onPress }));
  const commands = [...moved, ...menu];
  const words = <>
    <span className="ledge-row-line">
      <span className="ledge-row-kind" data-tone={kindTone}>{kind}</span>
      <span className="ledge-row-title">{title}</span>
    </span>
    {problem !== undefined ? <span className="ledge-row-problem">{problem}</span>
      : gist !== undefined && gist.trim() !== "" ? <span className="ledge-row-gist">{gist}</span> : null}
  </>;
  return <li ref={row} className="ledge-row" data-even={even || undefined}>
    {lead}
    {onTitle ? <button type="button" className="ledge-row-main" title={titleHint} onClick={onTitle}>{words}</button>
      : <span className="ledge-row-main">{words}</span>}
    <span className="ledge-row-actions">
      {status ? <span className="ledge-row-status" data-tone={status.tone} role="status">{status.text}</span>
        : inline.map((action) => <button key={action.label} type="button" className="ledge-row-button" data-tone={action.tone}
          title={action.title} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}
      {!status && commands.length > 0 ? <MenuButton label={menuLabel} commands={commands} layer="window" /> : null}
    </span>
    {children}
  </li>;
}
