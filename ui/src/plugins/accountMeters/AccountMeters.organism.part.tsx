import { useState } from "react";
import { AccountMeters } from "./AccountMeters";
import { ResetDialog } from "./ResetDialog";
import { meterModel } from "./meterModel";
import { resetPreview } from "./resetModel";
import type { QuotaPayload } from "./quotaData";
import { NOW, QUOTA, QUOTA_RESET_LAPSING, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "./fixtures/quota";

export const name = "Account meters";
export const note = "Each AI account's quota at the foot of the session list";

const providers = meterModel(QUOTA, SETTINGS, NOW);

export default function Open() {
  const [open, setOpen] = useState(true);
  return <AccountMeters open={open} onToggle={() => setOpen(!open)} onRetry={() => {}}
    view={{ type: "ready", providers, names: false, doubtful: false }} />;
}
export function Closed() {
  const [open, setOpen] = useState(false);
  return <AccountMeters open={open} status="39m old" onToggle={() => setOpen(!open)} onRetry={() => {}}
    view={{ type: "ready", providers, names: false, doubtful: true }} />;
}
export function WithAddresses() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "ready", providers, names: true, doubtful: false }} />;
}
export function EveryBar() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, {}, NOW), names: false, doubtful: false }} />;
}
export function Stale() {
  return <AccountMeters open status="39m old" onToggle={() => {}} onRetry={() => {}} view={{ type: "ready", providers, names: false, doubtful: true }} />;
}
export function Offline() {
  return <AccountMeters open status="Offline, 2h old" statusHint="Cannot reach cliproxyapi.hummingbird-lake.ts.net." onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers, names: false, doubtful: true }} />;
}
export function Unreachable() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "failed", message: "Cannot reach cliproxyapi.hummingbird-lake.ts.net." }} />;
}
/** The meters with banked resets, live: press a chip to open the question. */
function WithResetsAt({ payload, names = false, asking: first }: { payload: QuotaPayload; names?: boolean; asking?: string }) {
  const [open, setOpen] = useState(true);
  const [asking, setAsking] = useState<string | undefined>(first);
  const preview = asking === undefined ? undefined : resetPreview(payload, asking, NOW, ZONE);
  return <>
    <AccountMeters open={open} onToggle={() => setOpen(!open)} onRetry={() => {}} onAskReset={setAsking}
      view={{ type: "ready", providers: meterModel(payload, SETTINGS, NOW, ZONE), names, doubtful: false }} />
    {preview ? <ResetDialog preview={preview} onUse={() => setAsking(undefined)} onCancel={() => setAsking(undefined)} /> : null}
  </>;
}
export function WithResets() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} />;
}
export function WithResetsAndAddresses() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} names />;
}
export function ResetLapsingSoon() {
  return <WithResetsAt payload={QUOTA_RESET_LAPSING} names />;
}
export function AskingClaudeReset() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} names asking="claude/work@example.com" />;
}
export function AskingCodexReset() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} names asking="codex/team@example.com" />;
}
export function Loading() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "loading" }} />;
}
