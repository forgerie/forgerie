import { useState } from "react";
import { QuotaSheet } from "./QuotaSheet";
import { ResetDialog } from "./ResetDialog";
import { meterModel } from "./meterModel";
import { resetPreview } from "./resetModel";
import { NOW, QUOTA, QUOTA_RESET_LAPSING, QUOTA_WITH_RESETS, ZONE } from "./fixtures/quota";

export const name = "Quota sheet";
export const note = "Every account's lanes with their addresses, behind the account meters";

const providers = meterModel(QUOTA_WITH_RESETS, {}, NOW, ZONE);

export default function Open() {
  return <QuotaSheet providers={providers} doubtful={false} onClose={() => {}} onRefresh={() => {}} onAskReset={() => {}} />;
}
export function AtAnAccount() {
  return <QuotaSheet providers={providers} doubtful={false} focus="codex/team@example.com" onClose={() => {}} onRefresh={() => {}} onAskReset={() => {}} />;
}
export function Stale() {
  return <QuotaSheet providers={meterModel(QUOTA, {}, NOW, ZONE)} doubtful status="39m old" onClose={() => {}} onRefresh={() => {}} />;
}
export function ResetLapsingSoon() {
  return <QuotaSheet providers={meterModel(QUOTA_RESET_LAPSING, {}, NOW, ZONE)} doubtful={false} onClose={() => {}} onRefresh={() => {}} onAskReset={() => {}} />;
}
/** The sheet with the reset question over it, as a press on a chip opens it. */
export function AskingAReset() {
  const [asking, setAsking] = useState<string | undefined>("claude/work@example.com");
  const preview = asking === undefined ? undefined : resetPreview(QUOTA_WITH_RESETS, asking, NOW, ZONE);
  return <>
    <QuotaSheet providers={providers} doubtful={false} focus="claude/work@example.com" onClose={() => {}} onRefresh={() => {}} onAskReset={setAsking} />
    {preview ? <ResetDialog preview={preview} onUse={() => setAsking(undefined)} onCancel={() => setAsking(undefined)} /> : null}
  </>;
}
