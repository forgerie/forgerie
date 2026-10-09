import "./Figure.css";

export type FigureTone = "plain" | "muted" | "warn" | "bad" | "faint";

/**
 * System atom: one short figure, such as a share, a clock or an amount, in
 * the code face with tabular digits. The tone says whether it is a problem;
 * a figure that warns is also marked in words, never by colour alone.
 */
export function Figure({ children, tone = "muted", label }: { children: string; tone?: FigureTone; label?: string | undefined }) {
  return <span className="figure" data-tone={tone} aria-label={label} title={label}>{children}</span>;
}
