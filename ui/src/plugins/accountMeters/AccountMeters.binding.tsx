import { useRef, useState } from "react";
import { accountMetersManifest } from "@shared/appPluginManifests";
import type { AppPluginProps } from "../appPlugin";
import { AccountMeters, type MetersView } from "./AccountMeters";
import { ResetDialog } from "./ResetDialog";
import { meterModel } from "./meterModel";
import { showNames } from "./meterPlan";
import { isStale, spanLabel } from "./quotaData";
import { newRequestId as makeRequestId, redeemReset, withoutSpent, type RedeemOutcome, type RedeemReset, type SpentResets } from "./redeemReset";
import { resetPreview } from "./resetModel";
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
 * The question open for one account. The request id is made when the
 * question opens and kept through an uncertain answer, so asking again
 * replays that request and cannot spend a second reset. A refusal spent
 * nothing, so the next press gets a fresh id.
 */
interface Asking { key: string; requestId: string; busy: boolean; problem: Exclude<RedeemOutcome, { kind: "spent" }> | undefined }

/**
 * Binding: account meters. Reads the router and the reader's stored choice,
 * takes the room the session list reports, and hands the shape plain rows.
 * A banked reset is spent only from the question it opens, through the router.
 */
export function AccountMetersShelf({ settings, read, redeem = redeemReset, newRequestId = makeRequestId, clock = () => new Date() }: AppPluginProps & {
  read?: QuotaRead; redeem?: RedeemReset; newRequestId?: () => string; clock?: () => Date;
}) {
  const configured = settings["endpoint"];
  const endpoint = typeof configured === "string" ? configured : DEFAULT_ENDPOINT;
  const quota = useQuota(endpoint, read);
  const [open, setOpen] = useState(readOpen);
  const [room, setRoom] = useState(0);
  const [asking, setAsking] = useState<Asking | undefined>();
  const [spent, setSpent] = useState<SpentResets>({});
  // The question a pending answer belongs to, so an answer after Cancel changes nothing on screen.
  const current = useRef<string | undefined>(undefined);
  const now = clock();
  const payload = quota.payload ? withoutSpent(quota.payload, spent) : undefined;
  const age = payload ? spanLabel(Math.max(0, now.getTime() - new Date(payload.updatedAt).getTime())) : "";
  const stale = payload !== undefined && isStale(payload.updatedAt, now);
  const providers = payload ? meterModel(payload, settings, now) : undefined;
  const view: MetersView = providers ? { type: "ready", providers, names: showNames(room, providers), doubtful: quota.error !== undefined || stale }
    : quota.loading ? { type: "loading" } : { type: "failed", message: quota.error ?? "Quota data is unavailable." };
  const status = payload === undefined ? undefined : quota.error !== undefined ? `Offline, ${age} old` : stale ? `${age} old` : undefined;
  const toggle = () => { setOpen(!open); writeOpen(!open); };
  const preview = asking && payload ? resetPreview(payload, asking.key, now) : undefined;

  const ask = (key: string) => {
    const requestId = newRequestId();
    current.current = requestId;
    setAsking({ key, requestId, busy: false, problem: undefined });
  };
  const close = () => { current.current = undefined; setAsking(undefined); };
  const use = () => {
    if (!asking || !preview || asking.busy) return;
    const { key, requestId } = asking;
    setAsking({ ...asking, busy: true });
    void redeem(endpoint, { provider: preview.providerId, email: preview.email, requestId, clockPolicy: preview.restarts ? "restart" : "preserve" })
      .catch((error: unknown): RedeemOutcome => ({ kind: "uncertain", message: error instanceof Error ? error.message : String(error) }))
      .then((outcome) => {
        // A spend counts even if the reader closed the question while it ran.
        if (outcome.kind === "spent") {
          setSpent((previous) => ({ ...previous, [key]: [...(previous[key] ?? []), clock().getTime()] }));
          quota.retry();
        }
        if (current.current !== requestId) return;
        if (outcome.kind === "spent") { close(); return; }
        const next = outcome.kind === "refused" ? newRequestId() : requestId;
        current.current = next;
        setAsking({ key, requestId: next, busy: false, problem: outcome });
      });
  };

  return <>
    <AccountMeters view={view} open={open} status={status} statusHint={quota.error} onToggle={toggle} onRetry={quota.retry} onRoom={setRoom}
      onAskReset={ask} />
    {asking && preview ? <ResetDialog preview={preview} busy={asking.busy} problem={asking.problem} onUse={use} onCancel={close} /> : null}
  </>;
}
