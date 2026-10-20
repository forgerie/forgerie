// Deterministic streaming plans for controlled fixtures. No provider is involved.
// A token is one "." appended to a fixed prefix, so a cumulative count of
// suffix characters identifies how many events a frame has rendered.
export const STREAM_PREFIX = "Readable streaming last turn. Working on the deterministic fixture.";
export const STREAM_CADENCES = Object.freeze({
  "1hz": Object.freeze({ intervalMs: 1000, tokensPerTick: 1 }),
  "30hz": Object.freeze({ intervalMs: 33, tokensPerTick: 1 }),
  // Several events in one timer task: the browser may legitimately batch them.
  burst: Object.freeze({ intervalMs: 250, tokensPerTick: 25 }),
});
export const MAX_STREAM_TOKENS = 2000;

export function streamPlan(cadence = "1hz", tokens) {
  const shape = STREAM_CADENCES[cadence];
  if (shape === undefined) throw new Error(`Unknown stream cadence: ${cadence}`);
  if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > MAX_STREAM_TOKENS)) {
    throw new Error(`Stream tokens must be an integer from 1 to ${MAX_STREAM_TOKENS}`);
  }
  return { cadence, ...shape, tokens: tokens ?? null, finalText: tokens === undefined ? null : STREAM_PREFIX + ".".repeat(tokens) };
}

/** Tokens to publish on the next tick, given how many were already sent. Empty when finished. */
export function nextTick(plan, sent) {
  const remaining = plan.tokens === null ? plan.tokensPerTick : Math.max(0, plan.tokens - sent);
  return Array.from({ length: Math.min(plan.tokensPerTick, remaining) }, () => ".");
}

export function parseStreamArgs(argv) {
  const value = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const tokens = value("stream-tokens");
  return streamPlan(value("stream-cadence") ?? "1hz", tokens === undefined ? undefined : Number(tokens));
}
