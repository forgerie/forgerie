import { useState } from "react";
import { AccountMeters } from "./AccountMeters";
import { QuotaSheet } from "./QuotaSheet";
import { ResetDialog } from "./ResetDialog";
import { inService, meterModel } from "./meterModel";
import { resetPreview } from "./resetModel";
import type { QuotaPayload } from "./quotaData";
import { NOW, QUOTA, QUOTA_RESET_LAPSING, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "./fixtures/quota";

export const name = "Account meters";
export const note = "Each AI account's quota at the foot of the session list; press an account for its detail";

const providers = inService(meterModel(QUOTA, SETTINGS, NOW));

/** The meters, live: press an account to open the detail at it, and a chip there to ask about a reset. */
function Live({ payload, asking: first }: { payload: QuotaPayload; asking?: string }) {
  const [open, setOpen] = useState(true);
  const [sheet, setSheet] = useState<string | undefined>();
  const [asking, setAsking] = useState<string | undefined>(first);
  const preview = asking === undefined ? undefined : resetPreview(payload, asking, NOW, ZONE);
  return <>
    <AccountMeters open={open} onToggle={() => setOpen(!open)} onRetry={() => {}} onOpen={setSheet}
      view={{ type: "ready", providers: inService(meterModel(payload, SETTINGS, NOW, ZONE)), doubtful: false }} />
    {sheet === undefined ? null : <QuotaSheet providers={meterModel(payload, {}, NOW, ZONE)} doubtful={false} focus={sheet}
      onClose={() => setSheet(undefined)} onRefresh={() => {}} onAskReset={setAsking} />}
    {preview ? <ResetDialog preview={preview} onUse={() => setAsking(undefined)} onCancel={() => setAsking(undefined)} /> : null}
  </>;
}

export default function Open() {
  return <Live payload={QUOTA} />;
}
export function Closed() {
  const [open, setOpen] = useState(false);
  return <AccountMeters open={open} status="39m old" onToggle={() => setOpen(!open)} onRetry={() => {}}
    view={{ type: "ready", providers, doubtful: true }} />;
}
export function EveryBar() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "ready", providers: inService(meterModel(QUOTA, {}, NOW)), doubtful: false }} />;
}
export function Stale() {
  return <AccountMeters open status="39m old" onToggle={() => {}} onRetry={() => {}} view={{ type: "ready", providers, doubtful: true }} />;
}
export function Offline() {
  return <AccountMeters open status="Offline, 2h old" statusHint="Cannot reach cliproxyapi.hummingbird-lake.ts.net." onToggle={() => {}} onRetry={() => {}}
    view={{ type: "ready", providers, doubtful: true }} />;
}
export function Unreachable() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "failed", message: "Cannot reach cliproxyapi.hummingbird-lake.ts.net." }} />;
}
export function WithResets() {
  return <Live payload={QUOTA_WITH_RESETS} />;
}
export function ResetLapsingSoon() {
  return <Live payload={QUOTA_RESET_LAPSING} />;
}
export function AskingClaudeReset() {
  return <Live payload={QUOTA_WITH_RESETS} asking="claude/work@example.com" />;
}
export function AskingCodexReset() {
  return <Live payload={QUOTA_WITH_RESETS} asking="codex/team@example.com" />;
}
export function Loading() {
  return <AccountMeters open onToggle={() => {}} onRetry={() => {}} view={{ type: "loading" }} />;
}
