// The meters as lane groups, shared by the sidebar shelf and the Quota sheet,
// so a window is drawn by one rule in both places. Budgets are the product's
// PaceBar lanes unchanged; pools and balances take the candidate marks in
// quota-marks.tsx.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { RefreshCwIcon, Settings2Icon } from "lucide-react";
import { SheetDialog } from "../src/ui/SheetDialog";
import { LaneGrid, type LaneGroup } from "../src/ui/LaneGrid";
import { Figure } from "../src/ui/Figure";
import { Glyph } from "../src/ui/Glyph";
import { meterBlock } from "../src/plugins/accountMeters/AccountMeters";
import type { MeterProvider } from "../src/plugins/accountMeters/meterModel";
import { PROVIDER_MARKS } from "../src/plugins/accountMeters/providerMarks";
import { BalanceMark, BalanceValue, PoolMark, type BalanceStyle, type PoolStyle } from "./quota-marks";

export interface MarkStyles { pool: PoolStyle; balance: BalanceStyle }

function iconOf(provider: MeterProvider): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}

/** "$7" is 7, "<$1" is something under a dollar, "$0" is nothing. */
function dollarsOf(amount: string): number {
  if (amount.startsWith("<")) return 0.5;
  return Number(amount.replace(/[^0-9.]/g, "")) || 0;
}

/** Every account as a lane block, with pools and balances in the chosen marks. */
export function laneGroups(providers: readonly MeterProvider[], styles: MarkStyles, onAskReset?: (key: string) => void): LaneGroup[] {
  return providers.map((provider) => ({ key: provider.id, name: provider.name, icon: iconOf(provider), note: "—",
    blocks: provider.accounts.map((account, index) => {
      const block = meterBlock(account, provider.name, index, onAskReset);
      const lines = new Map(account.lines.map((line) => [line.id, line]));
      const rows = block.rows.map((row) => {
        const mark = lines.get(row.key)?.mark;
        if (mark?.kind === "pool") return { ...row, mark: <PoolMark style={styles.pool} refusing={mark.refusing} /> };
        if (mark?.kind === "balance") return { ...row,
          mark: <BalanceMark style={styles.balance} amount={mark.amount} dollars={dollarsOf(mark.amount)} tone={mark.tone} />,
          value: <BalanceValue style={styles.balance} amount={mark.amount} tone={mark.tone} /> };
        return row;
      });
      // A balance never resets. Out of the lane, its dash for a clock says nothing, so it goes.
      const balances = new Set(account.lines.flatMap((line, at) => line.mark.kind === "balance" ? [at] : []));
      const spans = styles.balance === "figure" ? block.spans
        : block.spans.filter((span) => !Array.from({ length: span.end - span.start }, (_, at) => span.start + at).every((at) => balances.has(at)));
      return { ...block, rows, spans };
    }) }));
}

/** Marks the block for `focus` and brings it into view once the sheet is drawn. Blocks follow the order of `keys`. */
function useLanding(root: React.RefObject<HTMLElement | null>, keys: readonly string[], focus: string | undefined) {
  useEffect(() => {
    if (focus === undefined) return;
    const frame = requestAnimationFrame(() => {
      const block = root.current?.querySelectorAll<HTMLElement>(".lane-grid-block")[keys.indexOf(focus)];
      if (!block) return;
      block.dataset.chosen = "";
      block.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [root, keys, focus]);
}

/**
 * The detail behind the shelf: the same lanes, larger, with each account's
 * address and every window, including those the shelf hides.
 */
export function QuotaSheet({ providers, styles, age, focus, onClose }: {
  providers: readonly MeterProvider[]; styles: MarkStyles; age: string; focus: string | undefined; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const keys = providers.flatMap((provider) => provider.accounts.map((account) => account.key));
  useLanding(root, keys, focus);
  const tools = <span className="qs-tools">
    <span className="qs-age" title="Read 1 minute ago" aria-label="Read 1 minute ago">{age}</span>
    <button type="button" className="qs-icon" aria-label="Refresh" title="Refresh"><RefreshCwIcon aria-hidden /></button>
    <button type="button" className="qs-icon" aria-label="Quota settings" title="Quota settings"><Settings2Icon aria-hidden /></button>
  </span>;
  return <SheetDialog title="Quota" subtitle={tools} onClose={onClose} closeLabel="Close quota">
    <div ref={root} className="qs"><LaneGrid groups={laneGroups(providers, styles, () => undefined)} captions flush /></div>
  </SheetDialog>;
}

/** The same lanes at sheet scale, outside a dialog, for side-by-side comparison. */
export function SheetLanes({ providers, styles, style }: { providers: readonly MeterProvider[]; styles: MarkStyles; style?: CSSProperties }) {
  return <div className="qs" style={style}><LaneGrid groups={laneGroups(providers, styles, () => undefined)} captions flush /></div>;
}
