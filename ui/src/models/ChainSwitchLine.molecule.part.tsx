import { ChainSwitchLine } from "./ChainSwitchLine";
import { MODELS } from "./fixtures/chains";

export const name = "Chain switch line";
export const note = "A session's model chain moved past an unavailable model: one quiet line in the thread, the provider's answer on request";

const RATE_LIMIT = "429 Too Many Requests: rate limit reached for claude-opus-5-5 in organization org-7Kq. Try again in 58s.";

export default function Switched() {
  return <ChainSwitchLine notice={{ from: "anthropic/claude-opus-5-5:high", to: "openai/gpt-5", error: RATE_LIMIT }} models={MODELS} />;
}
/** The server gave no reason: nothing opens but the references. */
export function NoReason() { return <ChainSwitchLine notice={{ from: "openai/gpt-5", to: "openai/gpt-5-mini:low", error: "" }} models={MODELS} />; }
/** Models the session no longer lists keep their references, and a long answer scrolls inside its box. */
export function UnknownModels() {
  return <ChainSwitchLine notice={{ from: "retired/claude-instant-1-with-a-very-long-identifier-and-no-breaks", to: "local/llama3:8b",
    error: `upstream connect error or disconnect/reset before headers. reset reason: connection termination ${"x".repeat(160)}` }} />;
}
