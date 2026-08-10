/**
 * Read how many delegated agents a tool says are working right now.
 *
 * Delegating tools report per-agent progress on their in-flight payload, which
 * Pi carries as `partialResult` on `tool_execution_update` and as `result` on
 * `tool_execution_end`. Reading the wrong one leaves the count at zero for a
 * whole run, which the inbox renders as "nothing is working".
 *
 * Deliberately shape-driven rather than keyed to one tool's name: any tool that
 * reports `progress[].status` is describing agents it has working.
 */
export function runningAgentCount(event: unknown): number | undefined {
  if (!isRecord(event)) return undefined;
  const payload = event["partialResult"] ?? event["result"];
  const progress = progressEntries(payload);
  if (progress === undefined) return undefined;
  let running = 0;
  for (const entry of progress) {
    if (isRecord(entry) && entry["status"] === "running") running += 1;
  }
  return running;
}

/**
 * Session files a tool result says it created.
 *
 * The same shape-driven rule: a result that hands back a `sessionFile` is
 * telling us it made that session, whichever tool it came from.
 */
export function spawnedSessionFiles(event: unknown): string[] {
  if (!isRecord(event)) return [];
  const details = detailsOf(event["result"]);
  if (details === undefined) return [];
  const results = details["results"];
  if (!Array.isArray(results)) return [];
  const files: string[] = [];
  for (const entry of results) {
    if (!isRecord(entry)) continue;
    const file = entry["sessionFile"];
    if (typeof file === "string" && file !== "") files.push(file);
  }
  return files;
}

/**
 * The `details` object of a tool payload, whether the payload is the details
 * itself or wraps them. Tool payloads reach the daemon in both shapes.
 */
function detailsOf(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  const nested = payload["details"];
  if (isRecord(nested)) return nested;
  return payload;
}

function progressEntries(payload: unknown): readonly unknown[] | undefined {
  const details = detailsOf(payload);
  if (details === undefined) return undefined;
  const progress = details["progress"];
  return Array.isArray(progress) ? progress : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
