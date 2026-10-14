import { Children, Fragment, useId, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, OctagonXIcon } from "lucide-react";
import "./WorkRow.css";

/**
 * The mark's state. `running` pulses, `waiting` is a ring, `finishing` is half
 * filled, `pending` is a dashed ring, and `blocked` is a square in the warn tone.
 */
export type WorkState = "pending" | "running" | "waiting" | "finishing" | "blocked";

/** A path may break after each slash, so a long one wraps at a folder and not inside a name. */
const breakable = (subject: string) => subject.split(/(?<=\/)/).map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>);

/**
 * Molecule: one unit of live work in an owner tree, as a disclosure. A state
 * mark, a label with an optional subject in the code face, a detail line, an
 * optional warning line, and the elapsed time. Pressing the row opens its body
 * under it. Rows it owns hang under it on a spine that drops from its mark. A
 * folded row says what it holds in place of its rows, and one press shows them.
 */
export function WorkRow({ state, label, subject, detail, warning, time, open, onToggle, body, actions, fold, children }: {
  state: WorkState;
  label: string;
  /** A path, a name, or a short command, in the code face after the label. */
  subject?: string | null | undefined;
  detail: string;
  /** A consequence the reader should know, in the warn ink with its icon. */
  warning?: string | undefined;
  /** Elapsed time; blank when it is not known. */
  time?: string | undefined;
  open: boolean;
  onToggle: () => void;
  /** What the row opens to. */
  body?: ReactNode;
  /** Quiet actions under the open body, such as `TextButton`s, lined up with its words. */
  actions?: ReactNode;
  /** Set while the rows under it are folded away: the words for what it holds, such as "3 tasks inside". */
  fold?: { label: string; onUnfold: () => void } | undefined;
  /** The rows under this one, as `WorkRow` elements. */
  children?: ReactNode;
}) {
  const bodyId = useId();
  return <li className="work-row" data-state={state}>
    <button type="button" className="work-row-main" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={onToggle}>
      <span className="work-row-mark" aria-hidden="true" />
      <span className="work-row-text">
        <span className="work-row-label">{label}{subject ? <> <code className="work-row-subject">{breakable(subject)}</code></> : null}</span>
        <span className="work-row-detail">{detail}</span>
        {warning ? <span className="work-row-warning"><OctagonXIcon className="work-row-warning-icon" aria-hidden />{warning}</span> : null}
      </span>
      <span className="work-row-time">{time}<ChevronDownIcon className="work-row-chevron" aria-hidden /></span>
    </button>
    {open ? <div id={bodyId} className="work-row-body">
      {body}
      {actions ? <div className="work-row-actions">{actions}</div> : null}
    </div> : null}
    {fold ? <button type="button" className="work-row-fold" aria-expanded={false} onClick={fold.onUnfold}>
      <ChevronRightIcon className="work-row-fold-icon" aria-hidden />{fold.label}
    </button> : Children.toArray(children).length > 0 ? <ul className="work-row-children">{children}</ul> : null}
  </li>;
}
