import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { cleanSessionName, deterministicSessionName, fallbackSessionName, generateShortSessionName, sessionNameIntent } from "./sessionNameGenerator.js";

function fakeModel(): Model<Api> {
  return { id: "fake-model", name: "Fake Model", api: "anthropic-messages", provider: "anthropic", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 };
}

function fakeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "fake-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

function streamThatCompletes(text: string): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = fakeAssistantMessage({ content: [{ type: "text", text }] });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
}

function streamThatErrors(): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = fakeAssistantMessage({ stopReason: "error", errorMessage: "boom" });
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
    return stream;
  };
}

describe("sessionNameGenerator", () => {
  it("asks for a short, distinctive retrieval label instead of a generic summary", async () => {
    let requestedContext: Parameters<StreamFn>[1] | undefined;
    const stream = streamThatCompletes("Forgerie Title Ownership");
    const streamFn: StreamFn = (model, context, options) => {
      requestedContext = context;
      return stream(model, context, options);
    };

    const request = "Can you help me understand whether Forgerie or my Pi profile generates session titles?";
    const name = await generateShortSessionName(streamFn, fakeModel(), request);

    expect(name).toBe("Forgerie Title Ownership");
    expect(requestedContext?.systemPrompt).toContain("1-4 word retrieval label");
    expect(requestedContext?.messages).toHaveLength(1);
    expect(requestedContext?.messages[0]?.content).toContain("Prefer specific names and compact noun phrases");
  });

  it("uses the request after an expanded skill instead of the skill instructions", async () => {
    let requestedContext: Parameters<StreamFn>[1] | undefined;
    const stream = streamThatCompletes("Skill Session Naming");
    const streamFn: StreamFn = (model, context, options) => {
      requestedContext = context;
      return stream(model, context, options);
    };
    const expandedSkill = `<skill name="se-debug" location="/skills/se-debug/SKILL.md">\n${"Generic debugging workflow. ".repeat(300)}\n</skill>\n\nauto session naming has degraded when i use skills`;

    const name = await generateShortSessionName(streamFn, fakeModel(), expandedSkill);

    expect(name).toBe("Skill Session Naming");
    expect(requestedContext?.messages[0]?.content).toContain("auto session naming has degraded when i use skills");
    expect(requestedContext?.messages[0]?.content).not.toContain("Generic debugging workflow");
  });

  it("returns undefined when the stream reports an error", async () => {
    const streamFn = streamThatErrors();

    const name = await generateShortSessionName(streamFn, fakeModel(), "Please fix the login bug");

    expect(name).toBeUndefined();
  });

  it("cleans model-generated titles", () => {
    expect(cleanSessionName('Title: "Fix Session Naming."\nextra')).toBe("Fix Session Naming");
  });

  it("rejects generated titles longer than four words before character truncation", () => {
    expect(cleanSessionName("Generic Session Title With Filler")).toBeUndefined();
    expect(cleanSessionName(`${"x".repeat(50)} two three four five`)).toBeUndefined();
  });

  it("extracts title intent from expanded skills", () => {
    expect(sessionNameIntent('<skill name="se-debug" location="/skills/se-debug/SKILL.md">\nDebug workflow\n</skill>\n\nFix session naming'))
      .toBe("Fix session naming");
    expect(sessionNameIntent('<skill name="se-debug" location="/skills/se-debug/SKILL.md">\nDebug workflow\n</skill>'))
      .toBe("/skill:se-debug");
  });

  it("builds deterministic names only for skill commands without request text", () => {
    expect(deterministicSessionName("/skill:se-architecture-improvement"))
      .toBe("Architecture Improvement");
    expect(deterministicSessionName("/skill:se-riffrec-feedback-analysis session.zip"))
      .toBeUndefined();
  });

  it("builds deterministic names for relay handoff prompts", () => {
    expect(deterministicSessionName('Relay "handoff-check" leg 2 begins now.\n\nYou are the next runner.'))
      .toBe("Relay handoff-check leg 2");
  });

  it("preserves the relay leg when truncating deterministic relay names", () => {
    expect(deterministicSessionName('Relay "very-long-relay-name-that-would-otherwise-push-the-leg-number-out-of-view" leg 42 begins now.'))
      .toBe("Relay very-long-relay-name-that-would-otherwise-push leg 42");
  });

  it("does not build deterministic names for non-canonical relay prompts", () => {
    expect(deterministicSessionName('You are continuing Relay "handoff-check" under the Relay method.'))
      .toBeUndefined();
  });

  it("builds a four-word, signal-dense fallback from the first request", () => {
    expect(fallbackSessionName("Please help me understand Forgerie session title ownership?"))
      .toBe("Forgerie session title ownership");
  });

  it("ignores skill blocks and filler words in fallback names", () => {
    expect(fallbackSessionName('<skill name="x" location="/x">\nDo x\n</skill>\n\nPlease help me check the Forgerie UI now'))
      .toBe("Forgerie UI");
  });

  it("skips fallback names when the first request is missing", () => {
    expect(fallbackSessionName(undefined)).toBeUndefined();
  });
});
