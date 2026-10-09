import { AccountMeters } from "./AccountMeters";
import { ResetDialog } from "./ResetDialog";
import { meterModel } from "./meterModel";
import { resetPreview, type ResetPreview } from "./resetModel";
import { NOW, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "./fixtures/quota";

export const name = "Reset dialog";
export const note = "Asks before spending a banked usage-limit reset, and says what happens to the reset date";

function preview(key: string): ResetPreview {
  const found = resetPreview(QUOTA_WITH_RESETS, key, NOW, ZONE);
  if (!found) throw new Error(`No reset for ${key}.`);
  return found;
}

/** The dialog opens at window level, so each state draws the meters it opened from behind it. */
function Asking({ account }: { account: string }) {
  return <>
    <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}} onAskReset={() => {}}
      view={{ type: "ready", providers: meterModel(QUOTA_WITH_RESETS, SETTINGS, "every", NOW, ZONE), names: true, doubtful: false }} />
    <ResetDialog preview={preview(account)} onUse={() => {}} onCancel={() => {}} />
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
