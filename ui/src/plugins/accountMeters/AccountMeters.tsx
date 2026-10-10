import type { ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Shelf, type ShelfMessage } from "../../ui/Shelf";
import { LaneGrid, type LaneBlock, type LaneGroup, type LaneRow } from "../../ui/LaneGrid";
import { PaceBar, type PaceState } from "../../ui/PaceBar";
import { SignalDot } from "../../ui/SignalDot";
import { PipRun } from "../../ui/PipRun";
import { Figure, type FigureTone } from "../../ui/Figure";
import { Glyph } from "../../ui/Glyph";
import type { ClockTone, Mark, MeterAccount, MeterProvider } from "./meterModel";
import { PROVIDER_MARKS } from "./providerMarks";

/** What the meters have to show. */
export type MetersView =
  | { type: "loading" }
  | { type: "failed"; message: string }
  | { type: "ready"; providers: readonly MeterProvider[]; doubtful: boolean };

const PACE: Record<string, PaceState> = { ok: "even", unpaced: "even", dry: "short", loss: "surplus", drained: "empty" };
const CLOCK: Record<ClockTone, FigureTone> = { plain: "muted", none: "faint", loss: "warn", dry: "bad" };
const BALANCE: Record<"ok" | "low" | "out", FigureTone> = { ok: "plain", low: "warn", out: "bad" };

/**
 * A lane's mark. A budget is a bar. A pool reports no level, so it is a run of
 * dots across the lane, with no end to read. A balance has no maximum, so it
 * is counted, a pip a dollar, and its amount stands with the shares.
 */
function markOf(mark: Mark): ReactNode {
  if (mark.kind === "pool") return <SignalDot run off={mark.refusing} />;
  if (mark.kind === "balance") return <PipRun count={mark.units} tone={mark.tone === "low" ? "warn" : "plain"} />;
  return <PaceBar value={mark.remaining} pace={mark.standing.pace} state={PACE[mark.standing.kind]} heat={mark.doom} />;
}

/** A service's mark, or its first letter where Forgerie has no mark for it. */
function iconOf(provider: MeterProvider): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}

/** What a block may do and how it stands. */
export interface BlockOptions {
  /** Asks to spend one of the account's banked resets. Without it, no account offers one. */
  onAskReset?: ((key: string) => void) | undefined;
  /** Opens the account's detail. Without it, the block takes no press. */
  onOpen?: ((key: string) => void) | undefined;
  /** The account the reader came for. */
  chosen?: string | undefined;
}

/** One account as a lane block. */
export function meterBlock(account: MeterAccount, provider: string, index: number, { onAskReset, onOpen, chosen }: BlockOptions = {}): LaneBlock {
  const who = account.email || provider;
  const reset = account.reset;
  // An account with nothing to draw still takes its line, marked by a quiet dash; its words say why.
  const rows: LaneRow[] = account.lines.length > 0
    ? account.lines.map((line) => ({ key: line.id, label: line.label, mark: markOf(line.mark), words: line.words,
      value: line.mark.kind === "balance" ? <Figure tone={BALANCE[line.mark.tone]}>{line.mark.amount}</Figure>
        : line.share === undefined ? undefined : <Figure>{line.share}</Figure> }))
    : [{ key: "empty", mark: <Figure tone="faint">—</Figure>, words: `${who}: ${account.empty ?? "nothing to show"}.` }];
  return {
    action: reset && onAskReset ? { label: `${reset.words}. Use a reset…`, icon: <RotateCcwIcon />, count: String(reset.count),
      tone: reset.soon ? "warn" : "live", onPress: () => onAskReset(account.key) } : undefined,
    press: onOpen ? { label: `Quota details for ${who}`, onPress: () => onOpen(account.key) } : undefined,
    chosen: chosen !== undefined && chosen === account.key,
    key: `${account.email}:${String(index)}`, caption: account.email || undefined, marked: account.routed, struck: account.out,
    label: `${who}${account.routed ? ", routed" : ""}${account.out ? ", out of service" : ""}`,
    rows,
    spans: account.clocks.map((run) => ({ start: run.start, end: run.end, content: <Figure tone={CLOCK[run.clock.tone]}>{run.clock.text}</Figure> })),
  };
}

/** Every account of every service as lane groups, each service named by its mark. */
export function meterGroups(providers: readonly MeterProvider[], options: BlockOptions = {}): LaneGroup[] {
  return providers.map((provider) => ({ key: provider.id, name: provider.name, icon: iconOf(provider), note: "—",
    blocks: provider.accounts.map((account, index) => meterBlock(account, provider.name, index, options)) }));
}

/**
 * Shape: account meters at the foot of the session list, as a heads-up
 * display. Open, every account of every service, each service named by its
 * mark and each account by its lanes alone; the addresses live in the detail.
 * Pressing an account opens that detail at it. Closed, the Quota header
 * alone. The reading's age, when it is old, sits at the header's end.
 */
export function AccountMeters({ view, open, status, statusHint, onToggle, onRetry, onAskReset, onOpen }: {
  view: MetersView;
  open: boolean;
  status?: string | undefined;
  statusHint?: string | undefined;
  onToggle: () => void;
  onRetry: () => void;
  /** Asks to spend one of an account's banked resets. Without it, no account offers one. */
  onAskReset?: ((key: string) => void) | undefined;
  /** Opens the quota detail at an account. Without it, the meters take no press. */
  onOpen?: ((key: string) => void) | undefined;
}) {
  const message: ShelfMessage | undefined = view.type === "loading" ? { text: "Reading quotas…" }
    : view.type === "failed" ? { text: view.message, alert: true, action: { label: "Retry", onPress: onRetry } }
    : view.providers.length === 0 ? { text: "The router reports no providers." } : undefined;
  return <Shelf id="account-meters" title="Quota" label="Account meters" open={open} onToggle={onToggle}
    toggleHint={open ? "Hide quota" : "Show quota"} status={status} statusHint={statusHint} message={message}>
    {view.type === "ready" ? <LaneGrid groups={meterGroups(view.providers, { onAskReset, onOpen })} captions={false} faded={view.doubtful} /> : null}
  </Shelf>;
}
