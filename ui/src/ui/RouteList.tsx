import { Fragment, type ReactNode } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { BlockRun, type BlockTone } from "./BlockRun";
import { TextButton } from "./TextButton";
import "./RouteList.css";

/** One line under an item's name. A tone colours the words: warn for trouble it works through, bad for a failure. */
export interface RouteLine { key: string; text: ReactNode; tone?: "warn" | "bad" | "live" | undefined }

/** Who works inside a step, such as a worker, with one block per unit of its work. */
export interface RouteListItem {
  key: string;
  /** Set in the code face. */
  name: string;
  /** What it is, after the name. */
  kind?: string | undefined;
  tones: readonly BlockTone[];
  /** What the blocks count, for screen readers. */
  blocksLabel?: string | undefined;
  /** Added by the reader, before anything else catches up. */
  added?: boolean | undefined;
  lines?: readonly RouteLine[] | undefined;
  /** A control under the lines, such as a picker. */
  control?: ReactNode;
  /** The control's value differs from the one proposed: it reads in the changed ink. */
  edited?: boolean | undefined;
  /** Opens the item. */
  onPress?: (() => void) | undefined;
  /** The item is open elsewhere. */
  selected?: boolean | undefined;
  remove?: { label: string; onPress: () => void } | undefined;
}

export interface RouteListStep {
  key: string;
  /** Unnumbered: a group with no place in the order. */
  number?: number | undefined;
  name: ReactNode;
  added?: boolean | undefined;
  /** One line under the name. `live` when it asks for the reader. */
  detail?: ReactNode;
  detailTone?: "live" | undefined;
  /** Where the process stands at this step. A finished step's number becomes a check; the step at work and one that waits are set heavier. */
  state?: "done" | "current" | "waiting" | "next" | undefined;
  /** The document beside the list shows this step now. */
  here?: boolean | undefined;
  /** The step is the reader's own: one block, in the given tone. */
  stopTone?: BlockTone | undefined;
  stopLabel?: string | undefined;
  /** The items' blocks, shown at the row's end while the items are folded away. */
  folded?: readonly BlockTone[] | undefined;
  foldedLabel?: string | undefined;
  onPress?: (() => void) | undefined;
  /** Whether pressing the step shows or hides its items. */
  expanded?: boolean | undefined;
  items?: readonly RouteListItem[] | undefined;
  remove?: { label: string; onPress: () => void } | undefined;
  /** Something under the step's items, such as a control that adds one. */
  after?: ReactNode;
}

function stepHead(step: RouteListStep) {
  return <>
    <span className="route-list-number">{step.state === "done" ? <CheckIcon aria-label="Done" /> : step.number}</span>
    <span className="route-list-text">
      <span className="route-list-name" data-added={step.added || undefined}>{step.name}</span>
      {step.detail !== undefined && step.detail !== null && <span className="route-list-detail" data-tone={step.detailTone}>{step.detail}</span>}
    </span>
    {(step.folded !== undefined || step.stopTone !== undefined) && <span className="route-list-marks">
      {step.folded !== undefined && <BlockRun tones={step.folded} label={step.foldedLabel} />}
      {step.stopTone !== undefined && <BlockRun tones={[step.stopTone]} label={step.stopLabel} />}
    </span>}
  </>;
}

function itemHead(item: RouteListItem) {
  return <>
    <span className="route-list-blocks"><BlockRun tones={item.tones} label={item.blocksLabel} /></span>
    <span className="route-list-who">
      <span className="route-list-who-line" data-added={item.added || undefined}><code>{item.name}</code>{item.kind !== undefined && <span>{item.kind}</span>}</span>
      {item.lines?.map((line) => <span key={line.key} className="route-list-line" data-tone={line.tone}>{line.text}</span>)}
    </span>
  </>;
}

const remove = (action: { label: string; onPress: () => void }) =>
  <button type="button" className="route-list-remove" aria-label={action.label} title={action.label} onClick={action.onPress}><XIcon aria-hidden /></button>;

/**
 * Molecule: a process as a flat numbered list: each step with its number, name and one line, and the items that work
 * in it, each with its blocks in a margin column. No boxes and no rules between steps; space separates them, and only
 * a row the reader points at or has open takes a wash. A step or an item with `onPress` is a button. A step can fold
 * its items into their blocks at its end. Between steps, `gap` can place a control, such as one that inserts a step.
 * With no steps, `empty` says so, and the gap before the first step can still add one.
 */
export function RouteList({ label, meta, action, steps, gap, empty }: {
  label: string;
  /** A readout beside the label, such as a count. */
  meta?: ReactNode;
  /** One quiet action beside the label, such as a switch into editing. */
  action?: { label: string; pressed?: boolean | undefined; onPress: () => void } | undefined;
  steps: readonly RouteListStep[];
  /** A control before the first step (`undefined`) or after the step with this key. */
  gap?: ((after: string | undefined) => ReactNode) | undefined;
  /** Said when there are no steps, above any control that adds the first. */
  empty?: string | undefined;
}) {
  const slot = (after: string | undefined) => { const content = gap?.(after); return content === undefined || content === null || content === false
    ? null : <li className="route-list-gap">{content}</li>; };
  return <section className="route-list" aria-label={label}>
    <div className="route-list-head">
      <h3 className="route-list-label">{label}</h3>
      {meta !== undefined && <span className="route-list-meta">{meta}</span>}
      {action !== undefined && <TextButton label={action.label} pressed={action.pressed} onPress={action.onPress} />}
    </div>
    {steps.length === 0 && empty !== undefined && <p className="route-list-empty">{empty}</p>}
    <ol className="route-list-steps" role="list">
      {slot(undefined)}
      {steps.map((step) => <Fragment key={step.key}>
        <li className="route-list-step" data-state={step.state} data-here={step.here || undefined}>
          <div className="route-list-row">
            {step.onPress === undefined ? <div className="route-list-stage">{stepHead(step)}</div>
              : <button type="button" className="route-list-stage" aria-current={step.here ? "location" : undefined}
                aria-expanded={step.items !== undefined && step.items.length > 0 && step.expanded !== undefined ? step.expanded : undefined}
                onClick={step.onPress}>{stepHead(step)}</button>}
            {step.remove !== undefined && remove(step.remove)}
          </div>
          {step.items !== undefined && step.items.length > 0 && <ul className="route-list-items" role="list">
            {step.items.map((item) => <li key={item.key} className="route-list-item">
              <div className="route-list-row">
                {item.onPress === undefined ? <div className="route-list-worker">{itemHead(item)}</div>
                  : <button type="button" className="route-list-worker" aria-current={item.selected ? "true" : undefined} onClick={item.onPress}>{itemHead(item)}</button>}
                {item.remove !== undefined && remove(item.remove)}
              </div>
              {item.control !== undefined && item.control !== null && <div className="route-list-control" data-edited={item.edited || undefined}>{item.control}</div>}
            </li>)}
          </ul>}
          {step.after !== undefined && step.after !== null && <div className="route-list-after">{step.after}</div>}
        </li>
        {slot(step.key)}
      </Fragment>)}
    </ol>
  </section>;
}
