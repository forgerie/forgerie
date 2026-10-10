import { AccountMeters } from "./AccountMeters";
import { ResetDialog } from "./ResetDialog";
import { meterModel } from "./meterModel";
import { resetPreview, type ResetPreview } from "./resetModel";
import type { RedeemOutcome } from "./redeemReset";
import type { QuotaPayload } from "./quotaData";
import { NOW, QUOTA_RESETS_HELD, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "./fixtures/quota";

export const name = "Reset dialog";
export const note = "Asks before spending a banked usage-limit reset, and says what happens to the reset date";

function preview(key: string, payload: QuotaPayload): ResetPreview {
  const found = resetPreview(payload, key, NOW, ZONE);
  if (!found) throw new Error(`No reset for ${key}.`);
  return found;
}

/** The dialog opens at window level, so each state draws the meters it opened from behind it. */
function Asking({ account, payload = QUOTA_WITH_RESETS, busy = false, problem }: {
  account: string; payload?: QuotaPayload; busy?: boolean; problem?: Exclude<RedeemOutcome, { kind: "spent" }>;
}) {
  return <>
    <AccountMeters open onToggle={() => {}} onRetry={() => {}}
      view={{ type: "ready", providers: meterModel(payload, SETTINGS, NOW, ZONE), doubtful: false }} />
    <ResetDialog preview={preview(account, payload)} busy={busy} problem={problem} onUse={() => {}} onCancel={() => {}} />
  </>;
}

export default function ClaudeKeepsItsDate() {
  return <Asking account="claude/work@example.com" />;
}
export function CodexStartsOver() {
  return <Asking account="codex/team@example.com" />;
}
export function CodexLastReset() {
  return <Asking account="codex/spare@example.com" />;
}
/** Codex says no reset applies yet, so the dialog holds the button and says why. */
export function CodexHoldsItsResets() {
  return <Asking account="codex/team@example.com" payload={QUOTA_RESETS_HELD} />;
}
export function Using() {
  return <Asking account="claude/work@example.com" busy />;
}
export function Refused() {
  return <Asking account="claude/work@example.com" problem={{ kind: "refused", message: "The provider reports no applicable reset at this time." }} />;
}
export function Uncertain() {
  return <Asking account="claude/work@example.com" problem={{ kind: "uncertain", message: "The router answered HTTP 502 (unknown)." }} />;
}
