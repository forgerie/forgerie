const MINUTE_MS = 60_000;

/** Milliseconds since an ISO start, or undefined when the start is unknown. */
export function elapsedSince(startedAt: string | undefined, now: number): number | undefined {
  if (startedAt === undefined || startedAt === "") return undefined;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return undefined;
  return Math.max(0, now - started);
}

/** A running turn's age, deliberately precise only to whole minutes. */
export function formatWorkingRuntime(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / MINUTE_MS);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${String(hours)}h`
    : `${String(hours)}h ${String(remainingMinutes)}m`;
}

/** Full words for the compact runtime's accessible name. */
export function workingRuntimeLabel(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / MINUTE_MS);
  if (minutes < 1) return "Working for less than 1 minute";
  if (minutes < 60) return `Working for ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourText = `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  if (remainingMinutes === 0) return `Working for ${hourText}`;
  const minuteText = `${String(remainingMinutes)} ${remainingMinutes === 1 ? "minute" : "minutes"}`;
  return `Working for ${hourText} ${minuteText}`;
}

/** Delay until the displayed whole-minute value can change. */
export function nextWorkingRuntimeTick(milliseconds: number): number {
  const elapsed = Math.max(0, milliseconds);
  const remainder = elapsed % MINUTE_MS;
  return remainder === 0 ? MINUTE_MS : MINUTE_MS - remainder;
}
