import { useState } from "react";
import { AccountMeters } from "./AccountMeters";
import { ResetDialog } from "./ResetDialog";
import { meterModel, type MeterMode } from "./meterModel";
import { resetPreview } from "./resetModel";
import type { QuotaPayload } from "./quotaData";
import { NOW, QUOTA, QUOTA_RESET_LAPSING, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "./fixtures/quota";

export const name = "Account meters";
export const note = "Each AI account's quota at the foot of the session list";

export default function EveryAccount() {
  const [mode, setMode] = useState<MeterMode>("every");
  return <AccountMeters mode={mode} onToggle={() => setMode(mode === "every" ? "glance" : "every")} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, SETTINGS, mode, NOW), names: false, doubtful: false }} />;
}
export function WithAddresses() {
  return <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, SETTINGS, "every", NOW), names: true, doubtful: false }} />;
}
export function EveryBar() {
  return <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, {}, "every", NOW), names: false, doubtful: false }} />;
}
export function OneLinePerProvider() {
  return <AccountMeters mode="glance" onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, SETTINGS, "glance", NOW), names: false, doubtful: false }} />;
}
export function Stale() {
  return <AccountMeters mode="every" status="39m old" onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, SETTINGS, "every", NOW), names: false, doubtful: true }} />;
}
export function Offline() {
  return <AccountMeters mode="every" status="Offline, 2h old" statusHint="Cannot reach cliproxyapi.hummingbird-lake.ts.net." onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers: meterModel(QUOTA, SETTINGS, "every", NOW), names: false, doubtful: true }} />;
}
export function Unreachable() {
  return <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}} view={{ type: "failed", message: "Cannot reach cliproxyapi.hummingbird-lake.ts.net." }} />;
}
/** The meters with banked resets, live: press a chip to open the question. */
function WithResetsAt({ payload, mode: start = "every", names = false, asking: first }: { payload: QuotaPayload; mode?: MeterMode; names?: boolean; asking?: string }) {
  const [mode, setMode] = useState<MeterMode>(start);
  const [asking, setAsking] = useState<string | undefined>(first);
  const preview = asking === undefined ? undefined : resetPreview(payload, asking, NOW, ZONE);
  return <>
    <AccountMeters mode={mode} onToggle={() => setMode(mode === "every" ? "glance" : "every")} onRetry={() => {}} onAskReset={setAsking}
      view={{ type: "ready", providers: meterModel(payload, SETTINGS, mode, NOW, ZONE), names, doubtful: false }} />
    {preview ? <ResetDialog preview={preview} onUse={() => setAsking(undefined)} onCancel={() => setAsking(undefined)} /> : null}
  </>;
}
export function WithResets() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} />;
}
export function WithResetsAndAddresses() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} names />;
}
export function ResetsAtAGlance() {
  return <WithResetsAt payload={QUOTA_WITH_RESETS} mode="glance" />;
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
  return <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}} view={{ type: "loading" }} />;
}
