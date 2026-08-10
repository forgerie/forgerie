import { describe, expect, test } from "vitest";
import { splitChatNotice } from "./chatNotices";

describe("splitChatNotice", () => {
  test("promotes the phrase before the first colon to a lead", () => {
    expect(splitChatNotice("Model response failed: rate limit exceeded")).toEqual({
      lead: "Model response failed.",
      detail: "rate limit exceeded",
    });
  });

  test("keeps text without a separator whole", () => {
    expect(splitChatNotice("The agent stopped responding")).toEqual({
      lead: "",
      detail: "The agent stopped responding",
    });
  });

  test("splits on the first separator only, so detail keeps its own colons", () => {
    expect(splitChatNotice("Tool failed: read src/a.ts: permission denied")).toEqual({
      lead: "Tool failed.",
      detail: "read src/a.ts: permission denied",
    });
  });

  test("keeps a long lead whole rather than promoting a sentence", () => {
    const long = "the model returned an unexpected and very long explanation: detail";
    expect(splitChatNotice(long)).toEqual({ lead: "", detail: long });
  });

  test("keeps multi-sentence leads whole", () => {
    const prose = "It failed. Then it retried: twice";
    expect(splitChatNotice(prose)).toEqual({ lead: "", detail: prose });
  });

  test("keeps text whole when either side is empty", () => {
    expect(splitChatNotice("failed: ")).toEqual({ lead: "", detail: "failed:" });
    expect(splitChatNotice(": detail")).toEqual({ lead: "", detail: ": detail" });
  });

  test("trims surrounding whitespace", () => {
    expect(splitChatNotice("  Couldn't send: retry in 24s  ")).toEqual({
      lead: "Couldn't send.",
      detail: "retry in 24s",
    });
  });
});
