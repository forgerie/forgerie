// Candidate marks for the two lanes that are not budgets, drawn in the lane
// column beside the bars, in the sidebar and in the sheet alike.
//
// A pool (Antigravity Gemini) answers or refuses and reports no level.
//   dot      today: one dot at the lane's start
//   dots     a dotted lane the bars' height: a lane, with no level to fill
//   fade     a bar that fades out before it ends: open, with no end to read
//
// A balance (OpenRouter credits) is dollars with no maximum and no reset.
//   figure   today: the amount in the lane, a dash for its clock
//   column   the amount in the share column, under the bars' shares; no clock
//   pips     one pip per whole dollar from the lane's start, so a low balance
//            is short the way an empty bar is; the amount in the share column
import type { CSSProperties, ReactNode } from "react";
import { SignalDot } from "../src/ui/SignalDot";
import { Figure, type FigureTone } from "../src/ui/Figure";

export type PoolStyle = "dot" | "dots" | "fade";
export type BalanceStyle = "figure" | "column" | "pips";
export const POOL_STYLES: readonly PoolStyle[] = ["dot", "dots", "fade"];
export const BALANCE_STYLES: readonly BalanceStyle[] = ["figure", "column", "pips"];

export type BalanceTone = "ok" | "low" | "out";
const FIGURE_TONE: Record<BalanceTone, FigureTone> = { ok: "plain", low: "warn", out: "bad" };

/** Past this many pips the run fades at its end: more than the lane is sure to hold. A guess until measured. */
const PIP_RUN = 24;

export function PoolMark({ style, refusing }: { style: PoolStyle; refusing: boolean }) {
  if (style === "dot") return <SignalDot off={refusing} />;
  return <i className="pool-mark" data-style={style} data-off={refusing || undefined} aria-hidden />;
}

/** The lane cell for a balance. Under `figure` the amount is the mark; otherwise the mark is drawn or empty and the amount moves to the value cell. */
export function BalanceMark({ style, amount, dollars, tone }: { style: BalanceStyle; amount: string; dollars: number; tone: BalanceTone }): ReactNode {
  if (style === "figure") return <Figure tone={FIGURE_TONE[tone]}>{amount}</Figure>;
  if (style === "column") return null;
  const whole = Math.floor(dollars);
  // Something under a dollar still draws a sliver: empty and nearly empty stop work at different moments.
  const vars = { "--dollars": whole === 0 && dollars > 0 ? 0.4 : Math.min(whole, PIP_RUN + 4) } as CSSProperties;
  return <i className="balance-pips" data-tone={tone} data-many={whole > PIP_RUN || undefined} style={vars} aria-hidden />;
}

/** The amount for the value cell, under every style but `figure`. */
export function BalanceValue({ style, amount, tone }: { style: BalanceStyle; amount: string; tone: BalanceTone }): ReactNode {
  return style === "figure" ? undefined : <Figure tone={FIGURE_TONE[tone]}>{amount}</Figure>;
}
