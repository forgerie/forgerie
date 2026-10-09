import { useState } from "react";
import { AccountMeters } from "./AccountMeters";
import { meterModel, type MeterMode } from "./meterModel";
import { NOW, QUOTA, SETTINGS } from "./fixtures/quota";

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
export function Loading() {
  return <AccountMeters mode="every" onToggle={() => {}} onRetry={() => {}} view={{ type: "loading" }} />;
}
