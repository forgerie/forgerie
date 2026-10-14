import type { ReactNode } from "react";
import { Undo2Icon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { TextButton } from "./TextButton";
import "./RuleBlock.css";

/** One line of a rule block's list, with the action that takes it back. */
export interface RuleBlockItem { key: string; text: string; undo: { label: string; onPress: () => void } }

/**
 * Molecule: something the reader should read before the text under it, marked as the decision card is: a rule on
 * the start side, no box, no wash, no icon. The rule takes a tone: warn for changes the text has not caught up with,
 * bad for a failure, plain otherwise. A title, one quiet action beside it, an optional list of lines in inline
 * Markdown, each with an icon to take it back, the content, and a quiet note.
 */
export function RuleBlock({ title, tone = "plain", action, items, note, children }: {
  title: string;
  tone?: "plain" | "warn" | "bad" | undefined;
  action?: { label: string; onPress: () => void } | undefined;
  items?: readonly RuleBlockItem[] | undefined;
  /** A quiet line at the end, such as what to do next. */
  note?: string | undefined;
  children?: ReactNode;
}) {
  return <section className="rule-block" data-tone={tone} aria-label={title}>
    <div className="rule-block-head">
      <p className="rule-block-title">{title}</p>
      {action !== undefined && <TextButton label={action.label} onPress={action.onPress} />}
    </div>
    {items !== undefined && items.length > 0 && <ul className="rule-block-items" role="list">
      {items.map((item) => <li key={item.key} className="rule-block-item">
        <span className="rule-block-text"><MarkdownFragment inline text={item.text} /></span>
        <button type="button" className="rule-block-undo" aria-label={item.undo.label} title={item.undo.label} onClick={item.undo.onPress}><Undo2Icon aria-hidden /></button>
      </li>)}
    </ul>}
    {children !== undefined && children !== null && <div className="rule-block-body">{children}</div>}
    {note !== undefined && <p className="rule-block-note">{note}</p>}
  </section>;
}
