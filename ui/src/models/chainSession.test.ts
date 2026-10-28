import { describe, expect, it } from "vitest";
import { MODEL_CHAIN_SWITCH_KIND } from "@shared/apiTypes";
import { statusSchema } from "../contracts";
import { chainEntryLabel, chainReferenceOf, chainReferenceText, chainText } from "../modelChoice";
import { convertMessage, fromHistory } from "../transcript";
import { chainSwitchOf } from "./chainSwitch";
import { chainWaitClock, chainWaitLeft, nextChainEntry } from "./chainWait";
import { CHAINS, MODELS } from "./fixtures/chains";

const status = { isStreaming: true, isCompacting: false, isBashRunning: false, queuedMessages: [] };

describe("chain words", () => {
  it("names each entry by Pi's name with its own level, and keeps an unknown model's reference", () => {
    expect(chainText(CHAINS.worker!, MODELS)).toBe("Claude Opus 5.5 (High), then GPT-5, then GPT-5 mini (Low)");
    expect(chainEntryLabel("retired/claude-instant-1", MODELS)).toBe("retired/claude-instant-1");
    expect(chainEntryLabel("local/llama3:8b", MODELS)).toBe("Llama 3 8B");
  });

  it("reads a reference without a provider as a chain, with an optional level for every entry", () => {
    expect(chainReferenceOf("worker")).toEqual({ name: "worker" });
    expect(chainReferenceOf("worker:high")).toEqual({ name: "worker", level: "high" });
    expect(chainReferenceOf("openai/gpt-5")).toBeUndefined();
    expect(chainReferenceOf(undefined)).toBeUndefined();
    expect(chainReferenceOf("  ")).toBeUndefined();
    expect(chainReferenceText("worker", "low")).toBe("worker:low");
    expect(chainReferenceText("worker", undefined)).toBe("worker");
  });
});

describe("a chain's wait", () => {
  it("counts down as a clock, rounded up to the second, and never below zero", () => {
    expect(chainWaitClock(42_000)).toBe("0:42");
    expect(chainWaitClock(41_001)).toBe("0:42");
    expect(chainWaitClock(61_000)).toBe("1:01");
    expect(chainWaitClock(0)).toBe("0:00");
    expect(chainWaitLeft({ until: 1_000 }, 5_000)).toBe(0);
    expect(chainWaitLeft({ until: 5_000 }, 1_000)).toBe(4_000);
  });

  it("guesses the next model from the chain's order, matched without levels", () => {
    expect(nextChainEntry(CHAINS, "worker", "anthropic/claude-opus-5-5")).toBe("openai/gpt-5");
    expect(nextChainEntry(CHAINS, "worker", "openai/gpt-5:high")).toBe("openai/gpt-5-mini:low");
    expect(nextChainEntry(CHAINS, "worker", "openai/gpt-5-mini")).toBeUndefined();
    expect(nextChainEntry(CHAINS, "worker", "retired/model")).toBeUndefined();
    expect(nextChainEntry(CHAINS, "gone", "openai/gpt-5")).toBeUndefined();
    expect(nextChainEntry(undefined, "worker", "openai/gpt-5")).toBeUndefined();
  });

  it("reads the chain and its wait from the session's status, and drops malformed ones without losing the status", () => {
    const wait = { from: "openai/gpt-5", error: "429", until: 1_700_000_000_000 };
    expect(statusSchema.parse({ ...status, modelChain: "worker", chainWait: wait })).toMatchObject({ modelChain: "worker", chainWait: wait });
    const broken = statusSchema.parse({ ...status, modelChain: 7, chainWait: { from: "x" } });
    expect(broken.modelChain).toBeUndefined();
    expect(broken.chainWait).toBeUndefined();
    expect(broken.isStreaming).toBe(true);
  });
});

describe("a chain switch in the transcript", () => {
  const entry = (details: unknown, content: string = "") => ({ role: "custom", customType: MODEL_CHAIN_SWITCH_KIND, timestamp: 9, content, details });
  const notice = { from: "anthropic/claude-opus-5-5:high", to: "openai/gpt-5", error: "429 Too Many Requests" };

  it("reads the notice from the entry's details, past the session file's own fields, or from its text", () => {
    expect(chainSwitchOf(entry({ ...notice, entryId: "e1" }))).toEqual(notice);
    expect(chainSwitchOf(entry(undefined, JSON.stringify(notice)))).toEqual(notice);
    expect(chainSwitchOf(entry({ from: "a/b" }))).toBeUndefined();
    expect(chainSwitchOf({ role: "custom", customType: "forgerie:pull-request", details: notice })).toBeUndefined();
  });

  it("becomes a system row with the notice as its artifact, never a reply", () => {
    const state = fromHistory([entry(notice)]);
    expect(state.messages).toHaveLength(1);
    const [row] = state.messages;
    expect(row).toMatchObject({ role: "system", chainSwitch: notice });
    expect(convertMessage(row!)).toMatchObject({ role: "system", metadata: { custom: { chainSwitch: notice } } });
  });

  it("shows an entry it cannot read as plain system text, and drops one with no text", () => {
    expect(fromHistory([entry({ nonsense: true }, "The chain moved on.")]).messages).toMatchObject([{ role: "system", parts: [{ type: "text", text: "The chain moved on." }] }]);
    expect(fromHistory([entry({ nonsense: true }, "The chain moved on.")]).messages[0]?.chainSwitch).toBeUndefined();
    expect(fromHistory([entry({ nonsense: true })]).messages).toEqual([]);
  });
});
