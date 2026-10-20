// Measurement helpers only. No product state, credentials, or transcript is retained.
export function summarize(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error("Expected nonnegative finite samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
  return { n: sorted.length, min: sorted[0], median: percentile(0.5), max: sorted.at(-1),
    p95: sorted.length >= 100 ? percentile(0.95) : null,
    p99: sorted.length >= 1000 ? percentile(0.99) : null };
}

// Self-contained so CDP evaluates this exact tested predicate in the real page.
// A selected row or a generic "start of chat" marker alone is never readiness.
export function destinationReady(document, target) {
  if (!target.marker) return false;
  const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const row = document.getElementById(`picker-row-${target.id}`);
  if (row?.getAttribute("aria-selected") !== "true"
    || new URL(document.defaultView.location.href).searchParams.get("session") !== target.id) return false;
  const visible = (node, within) => {
    if (!node) return false;
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (!within || box.bottom > within.top && box.top < within.bottom);
  };
  return [...document.querySelectorAll(".session-shell")].some(shell => {
    // Native sessions can use the generic heading "Session". The route, selected
    // row, and API-derived unique reply identify the destination, not that heading.
    if (!visible(shell)) return false;
    const transcript = shell.querySelector(".transcript");
    if (!visible(transcript) || !visible(shell.querySelector("[data-composer-input]"))) return false;
    const box = transcript.getBoundingClientRect();
    return [...transcript.querySelectorAll(".message-text")].some(message =>
      visible(message, box) && normalize(message.textContent).includes(target.marker));
  });
}

export function matchTokenPaints(received, paints, initialCount) {
  if (!Number.isSafeInteger(initialCount) || initialCount < 0) throw new Error("Missing initial token count");
  if (received.some((event, index) => !Number.isSafeInteger(event.seq) || index > 0 && event.seq <= received[index - 1].seq)) throw new Error("Token event identities must advance");
  let previous = initialCount;
  return paints.map(paint => {
    if (!Number.isSafeInteger(paint.length) || paint.length <= previous) throw new Error("Painted token count must advance");
    const event = received[paint.length - initialCount - 1];
    if (!event) throw new Error("Every painted token needs a received event identity");
    if (event.at > paint.observed || paint.observed > paint.paintOpportunity) throw new Error("Receive and DOM clocks must agree");
    const batchedTokens = paint.length - previous; previous = paint.length;
    return { seq: event.seq, batchedTokens, receiveToDomMs: paint.observed - event.at, receiveToPaintOpportunityMs: paint.paintOpportunity - event.at };
  });
}

/**
 * Chromium ignores history updates beyond 200 within 10 s in one document and logs
 * "Throttling navigation to prevent the browser from hanging" (crbug.com/1038223).
 * The app pushes one entry per session switch, so an unpaced runner faster than
 * 50 ms per switch can leave the URL behind the selection. Runners keep click
 * starts this far apart; the idle gap lies outside every timed interval.
 */
export const SWITCH_PACE_MS = 60;
export function paceDelay(lastClickMs, nowMs, paceMs = SWITCH_PACE_MS) {
  if (!Number.isFinite(paceMs) || paceMs < 0) throw new Error("Pace must be a nonnegative number of milliseconds");
  return lastClickMs === undefined ? 0 : Math.max(0, paceMs - (nowMs - lastClickMs));
}

export function routeLabel(address) {
  const path = new URL(address, "http://localhost").pathname;
  if (path.startsWith("/assets/")) return "asset";
  return path.replace(/\/sessions\/[^/]+/u, "/sessions/:id")
    .replace(/\/processes\/[^/]+/u, "/processes/:id")
    .replace(/\/projects\/[^/]+/u, "/projects/:id");
}
