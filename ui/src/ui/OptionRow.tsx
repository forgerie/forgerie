import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import "./OptionRow.css";

/**
 * A short fact under a choice's name. `strong` reads in the text colour.
 * `truncate: "start"` gives way at its start, so the end that tells rows
 * apart (the last folders of a path) stays visible; the title holds it all.
 */
export type OptionDetail = string | { text: string; strong?: boolean | undefined; truncate?: "start" | undefined };
/**
 * Where a row's details sit. `under` gives them their own line, so a long one
 * can wrap; `trailing` keeps them on the name's line and lets them give way at
 * the end, for a list where every row must hold one height whatever the text.
 */
export type OptionDetailPlacement = "under" | "trailing";
/** How strongly a choice reads: plain, quiet (offered, with less to it), or faint (off its usual list). */
export type OptionTone = "plain" | "quiet" | "faint";

export interface OptionRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "style"> {
  name: string;
  /** A mark before the name, such as a file or folder icon. */
  icon?: ReactNode;
  /** Tells a choice apart from another with the same name. */
  variant?: string | undefined;
  details?: readonly OptionDetail[] | undefined;
  /** Where the details sit: their own line (default), or the name's line. */
  detailsPlacement?: OptionDetailPlacement | undefined;
  /** The choice in effect: a check mark, and `aria-current`. */
  current?: boolean | undefined;
  tone?: OptionTone | undefined;
  /** Shown, but not open to a choice right now. */
  blocked?: boolean | undefined;
  /** A choice of this row is in progress. */
  busy?: boolean | undefined;
}

/**
 * Atom: one choice in a list, as a button. A name with an optional variant
 * and leading mark, short details under it, and a check on the choice in
 * effect. It forwards its ref and spreads every other prop onto the button, so
 * a primitive can give it behaviour through `asChild`.
 */
export const OptionRow = forwardRef<HTMLButtonElement, OptionRowProps>(function OptionRow(
  { name, icon, variant, details = [], detailsPlacement = "under", current, tone = "plain", blocked, busy, type = "button", ...rest }, ref) {
  const trailing = detailsPlacement === "trailing";
  return <button ref={ref} type={type} className="option-row" data-tone={tone === "plain" ? undefined : tone} data-icon={icon ? "" : undefined}
    data-details={trailing ? "trailing" : undefined}
    aria-current={current || undefined} aria-disabled={blocked || undefined} aria-busy={busy || undefined} {...rest}>
    {icon && <span className="option-row-icon" aria-hidden>{icon}</span>}
    <span className="option-row-name">{name}{variant && <span className="option-row-variant">{variant}</span>}</span>
    {details.length > 0 && <span className="option-row-details" {...(trailing ? { title: details.map((detail) => typeof detail === "string" ? detail : detail.text).join(" ") } : {})}>{details.map((detail, index) => typeof detail === "string"
      ? <span key={index}>{detail}</span>
      : detail.truncate === "start"
        ? <span key={index} className="option-row-path" title={detail.text}><bdi dir="ltr">{detail.text}</bdi></span>
        : <span key={index} className="option-row-strong">{detail.text}</span>)}</span>}
    {current && <CheckIcon aria-hidden size={16} className="option-row-check" />}
  </button>;
});
