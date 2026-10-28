import { ChainWaitStatus } from "./ChainWaitStatus";
import { MODELS } from "./fixtures/chains";

export const name = "Chain wait status";
export const note = "A session's model chain waits before it moves past an unavailable model: time left, the model it waits for, and the next one";

/** A fixed moment, so every picture shows the same clock. */
const NOW = Date.UTC(2026, 9, 28, 14, 0, 0);
const WAIT = { from: "anthropic/claude-opus-5-5:high", error: "429 Too Many Requests: rate limit reached. Try again in 42s.", until: NOW + 42_000 };
const stop = () => undefined;

export default function Waiting() { return <ChainWaitStatus wait={WAIT} next="openai/gpt-5" models={MODELS} now={NOW} onStop={stop} />; }
/** The input bar shows its own Stop while the run runs, so the line has none. */
export function WhileRunning() { return <ChainWaitStatus wait={WAIT} next="openai/gpt-5" models={MODELS} now={NOW} />; }
/** The chain is not known yet, or this is its last entry: no next model. */
export function NoNext() { return <ChainWaitStatus wait={{ ...WAIT, until: NOW + 61_000 }} models={MODELS} now={NOW} onStop={stop} />; }
export function TimeUp() { return <ChainWaitStatus wait={{ ...WAIT, until: NOW - 1_000 }} next="openai/gpt-5" models={MODELS} now={NOW} onStop={stop} />; }
/** Models the session does not list keep their long references. */
export function LongNames() {
  return <ChainWaitStatus wait={{ ...WAIT, from: "retired/claude-instant-1-with-a-very-long-identifier-and-no-breaks" }}
    next="nightly-provider/regression-triage-with-the-cheapest-model-that-still-reads-diffs:minimal" now={NOW} onStop={stop} />;
}
