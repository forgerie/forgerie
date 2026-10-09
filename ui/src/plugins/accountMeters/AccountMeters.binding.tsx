import { useState } from "react";
import { accountMetersManifest } from "@shared/appPluginManifests";
import type { AppPluginProps } from "../appPlugin";
import { AccountMeters, type MetersView } from "./AccountMeters";
import { meterModel, type MeterMode } from "./meterModel";
import { meterLayout, type MeterChoice } from "./meterPlan";
import { isStale, spanLabel } from "./quotaData";
import { useQuota, type QuotaRead } from "./useQuota";

const MODE_KEY = "forgerie.accountMeters.mode";
const endpointDef = accountMetersManifest.settings.find((def) => def.id === "endpoint");
const DEFAULT_ENDPOINT = endpointDef?.type === "url" ? endpointDef.default : "";
/** The reader's choice from the header. Until they make one, the room decides. */
function readChoice(): MeterChoice {
  try { const stored = localStorage.getItem(MODE_KEY); return stored === "glance" || stored === "every" ? stored : "auto"; } catch { return "auto"; }
}
function writeChoice(mode: MeterMode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* A private window keeps the choice for this page only. */ }
}

/**
 * Binding: account meters. Reads the router and the reader's stored choice,
 * takes the room the session list reports, and hands the shape plain rows.
 */
export function AccountMetersShelf({ settings, read, clock = () => new Date() }: AppPluginProps & { read?: QuotaRead; clock?: () => Date }) {
  const configured = settings["endpoint"];
  const quota = useQuota(typeof configured === "string" ? configured : DEFAULT_ENDPOINT, read);
  const [choice, setChoice] = useState(readChoice);
  const [room, setRoom] = useState(0);
  const now = clock();
  const { payload } = quota;
  const layout = payload ? meterLayout(room, choice, (mode) => meterModel(payload, settings, mode, now)) : undefined;
  const mode = layout?.mode ?? (choice === "auto" ? "every" : choice);
  const age = payload ? spanLabel(Math.max(0, now.getTime() - new Date(payload.updatedAt).getTime())) : "";
  const stale = payload !== undefined && isStale(payload.updatedAt, now);
  const view: MetersView = payload ? { type: "ready", providers: meterModel(payload, settings, mode, now), names: layout?.names ?? true,
    doubtful: quota.error !== undefined || stale }
    : quota.loading ? { type: "loading" } : { type: "failed", message: quota.error ?? "Quota data is unavailable." };
  const status = payload === undefined ? undefined : quota.error !== undefined ? `Offline, ${age} old` : stale ? `${age} old` : undefined;
  const toggle = () => { const next = mode === "every" ? "glance" : "every"; setChoice(next); writeChoice(next); };
  return <AccountMeters view={view} mode={mode} status={status} statusHint={quota.error} onToggle={toggle} onRetry={quota.retry} onRoom={setRoom} />;
}
