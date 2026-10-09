import { useState } from "react";
import { accountMetersManifest } from "@shared/appPluginManifests";
import type { AppPluginProps } from "../appPlugin";
import { AccountMeters, type MetersView } from "./AccountMeters";
import { meterModel } from "./meterModel";
import { showNames } from "./meterPlan";
import { isStale, spanLabel } from "./quotaData";
import { useQuota, type QuotaRead } from "./useQuota";

/** Whether the reader closed the meters. Open unless they did. */
const CLOSED_KEY = "forgerie.accountMeters.closed";
const endpointDef = accountMetersManifest.settings.find((def) => def.id === "endpoint");
const DEFAULT_ENDPOINT = endpointDef?.type === "url" ? endpointDef.default : "";
function readOpen(): boolean {
  try { return localStorage.getItem(CLOSED_KEY) !== "true"; } catch { return true; }
}
function writeOpen(open: boolean) {
  try { if (open) localStorage.removeItem(CLOSED_KEY); else localStorage.setItem(CLOSED_KEY, "true"); }
  catch { /* A private window keeps the choice for this page only. */ }
}

/**
 * Binding: account meters. Reads the router and the reader's stored choice,
 * takes the room the session list reports, and hands the shape plain rows.
 */
export function AccountMetersShelf({ settings, read, clock = () => new Date() }: AppPluginProps & { read?: QuotaRead; clock?: () => Date }) {
  const configured = settings["endpoint"];
  const quota = useQuota(typeof configured === "string" ? configured : DEFAULT_ENDPOINT, read);
  const [open, setOpen] = useState(readOpen);
  const [room, setRoom] = useState(0);
  const now = clock();
  const { payload } = quota;
  const age = payload ? spanLabel(Math.max(0, now.getTime() - new Date(payload.updatedAt).getTime())) : "";
  const stale = payload !== undefined && isStale(payload.updatedAt, now);
  const providers = payload ? meterModel(payload, settings, now) : undefined;
  const view: MetersView = providers ? { type: "ready", providers, names: showNames(room, providers), doubtful: quota.error !== undefined || stale }
    : quota.loading ? { type: "loading" } : { type: "failed", message: quota.error ?? "Quota data is unavailable." };
  const status = payload === undefined ? undefined : quota.error !== undefined ? `Offline, ${age} old` : stale ? `${age} old` : undefined;
  const toggle = () => { setOpen(!open); writeOpen(!open); };
  return <AccountMeters view={view} open={open} status={status} statusHint={quota.error} onToggle={toggle} onRetry={quota.retry} onRoom={setRoom} />;
}
