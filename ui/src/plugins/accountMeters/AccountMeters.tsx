import type { ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Shelf, type ShelfMessage } from "../../ui/Shelf";
import { LaneGrid, type LaneBlock, type LaneGroup, type LaneRow } from "../../ui/LaneGrid";
import { PaceBar, type PaceState } from "../../ui/PaceBar";
import { SignalDot } from "../../ui/SignalDot";
import { Figure, type FigureTone } from "../../ui/Figure";
import { Glyph } from "../../ui/Glyph";
import type { ClockTone, Mark, MeterAccount, MeterProvider } from "./meterModel";
import { PROVIDER_MARKS } from "./providerMarks";

/** What the meters have to show. */
export type MetersView =
  | { type: "loading" }
  | { type: "failed"; message: string }
  | { type: "ready"; providers: readonly MeterProvider[]; names: boolean; doubtful: boolean };

const PACE: Record<string, PaceState> = { ok: "even", unpaced: "even", dry: "short", loss: "surplus", drained: "empty" };
const CLOCK: Record<ClockTone, FigureTone> = { plain: "muted", none: "faint", loss: "warn", dry: "bad" };
const BALANCE: Record<"ok" | "low" | "out", FigureTone> = { ok: "plain", low: "warn", out: "bad" };

function markOf(mark: Mark): ReactNode {
  if (mark.kind === "pool") return <SignalDot off={mark.refusing} />;
  if (mark.kind === "balance") return <Figure tone={BALANCE[mark.tone]}>{mark.amount}</Figure>;
  return <PaceBar value={mark.remaining} pace={mark.standing.pace} state={PACE[mark.standing.kind]} heat={mark.doom} />;
}

/** A service's mark, or its first letter where Forgerie has no mark for it. */
function iconOf(provider: MeterProvider): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}

/** One account as a lane block. `onAskReset`, when given, turns a banked reset into the block's action. */
export function meterBlock(account: MeterAccount, provider: string, index: number, onAskReset?: (key: string) => void): LaneBlock {
  const who = account.email || provider;
  const reset = account.reset;
  // An account with nothing to draw still takes its line, marked by a quiet dash; its words say why.
  const rows: LaneRow[] = account.lines.length > 0
    ? account.lines.map((line) => ({ key: line.id, label: line.label, mark: markOf(line.mark), words: line.words,
      value: line.share === undefined ? undefined : <Figure>{line.share}</Figure> }))
    : [{ key: "empty", mark: <Figure tone="faint">—</Figure>, words: `${who}: ${account.empty ?? "nothing to show"}.` }];
  return {
    action: reset && onAskReset ? { label: `${reset.words}. Use a reset…`, icon: <RotateCcwIcon />, count: String(reset.count),
      tone: reset.soon ? "warn" : "live", onPress: () => onAskReset(account.key) } : undefined,
    key: `${account.email}:${String(index)}`, caption: account.email || undefined, marked: account.routed, struck: account.out,
    label: `${who}${account.routed ? ", routed" : ""}${account.out ? ", out of service" : ""}`,
    rows,
    spans: account.clocks.map((run) => ({ start: run.start, end: run.end, content: <Figure tone={CLOCK[run.clock.tone]}>{run.clock.text}</Figure> })),
  };
}

/**
 * Shape: account meters at the foot of the session list. Open, every account
 * of every service, each service named by its mark. Closed, the Quota header
 * alone. The reading's age, when it is old, sits at the header's end.
 */
export function AccountMeters({ view, open, status, statusHint, onToggle, onRetry, onRoom, onAskReset }: {
  view: MetersView;
  open: boolean;
  status?: string | undefined;
  statusHint?: string | undefined;
  onToggle: () => void;
  onRetry: () => void;
  onRoom?: ((height: number) => void) | undefined;
  /** Asks to spend one of an account's banked resets. Without it, no account offers one. */
  onAskReset?: ((key: string) => void) | undefined;
}) {
  const message: ShelfMessage | undefined = view.type === "loading" ? { text: "Reading quotas…" }
    : view.type === "failed" ? { text: view.message, alert: true, action: { label: "Retry", onPress: onRetry } }
    : view.providers.length === 0 ? { text: "The router reports no providers." } : undefined;
  const groups: LaneGroup[] = view.type === "ready" ? view.providers.map((provider) => ({ key: provider.id, name: provider.name, icon: iconOf(provider),
    note: "—", blocks: provider.accounts.map((account, index) => meterBlock(account, provider.name, index, onAskReset)) })) : [];
  return <Shelf id="account-meters" title="Quota" label="Account meters" open={open} onToggle={onToggle}
    toggleHint={open ? "Hide quota" : "Show quota"} status={status} statusHint={statusHint} message={message} onRoom={onRoom}>
    {view.type === "ready" ? <LaneGrid groups={groups} captions={view.names} faded={view.doubtful} /> : null}
  </Shelf>;
}
