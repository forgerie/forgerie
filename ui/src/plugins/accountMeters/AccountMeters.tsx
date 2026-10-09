import type { ReactNode } from "react";
import { Shelf, type ShelfMessage } from "../../ui/Shelf";
import { LaneGrid, type LaneBlock, type LaneGroup } from "../../ui/LaneGrid";
import { PaceBar, type PaceState } from "../../ui/PaceBar";
import { SignalDot } from "../../ui/SignalDot";
import { Figure, type FigureTone } from "../../ui/Figure";
import type { ClockTone, Mark, MeterAccount, MeterMode, MeterProvider } from "./meterModel";

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

function blockOf(account: MeterAccount, provider: string, index: number): LaneBlock {
  const who = account.email || provider;
  return {
    key: `${account.email}:${String(index)}`, caption: account.email || undefined, marked: account.routed, struck: account.out, note: account.empty,
    label: `${who}${account.routed ? ", routed" : ""}${account.out ? ", out of service" : ""}`,
    rows: account.lines.map((line) => ({ key: line.id, label: line.label, mark: markOf(line.mark), words: line.words,
      value: line.share === undefined ? undefined : <Figure>{line.share}</Figure> })),
    spans: account.clocks.map((run) => ({ start: run.start, end: run.end, content: <Figure tone={CLOCK[run.clock.tone]}>{run.clock.text}</Figure> })),
  };
}

/**
 * Shape: account meters at the foot of the session list. The Quota header
 * switches between every account and one line per provider; the reading's
 * age, when it is old, sits at its end.
 */
export function AccountMeters({ view, mode, status, statusHint, onToggle, onRetry, onRoom }: {
  view: MetersView;
  mode: MeterMode;
  status?: string | undefined;
  statusHint?: string | undefined;
  onToggle: () => void;
  onRetry: () => void;
  onRoom?: ((height: number) => void) | undefined;
}) {
  const message: ShelfMessage | undefined = view.type === "loading" ? { text: "Reading quotas…" }
    : view.type === "failed" ? { text: view.message, alert: true, action: { label: "Retry", onPress: onRetry } }
    : view.providers.length === 0 ? { text: "The router reports no providers." } : undefined;
  const groups: LaneGroup[] = view.type === "ready" ? view.providers.map((provider) => ({ key: provider.id, name: provider.name, note: "No accounts",
    blocks: provider.accounts.map((account, index) => blockOf(account, provider.name, index)) })) : [];
  return <Shelf title="Quota" label="Account meters" open={mode === "every"} onToggle={onToggle}
    toggleHint={mode === "every" ? "Show one line per provider" : "Show every account"} status={status} statusHint={statusHint} message={message} onRoom={onRoom}>
    {view.type === "ready" ? <LaneGrid groups={groups} captions={view.names} dense={mode === "glance"} faded={view.doubtful} /> : null}
  </Shelf>;
}
