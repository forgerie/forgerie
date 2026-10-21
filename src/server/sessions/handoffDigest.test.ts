import { describe, expect, it } from "vitest";
import { DEFAULT_HANDOFF_DIGEST_LIMITS, handoffBranchDigest, type HandoffDigestLimits } from "./handoffDigest.js";

const user = (text: string, id = "u") => ({ type: "message", id, timestamp: "2026-10-19T17:52:00.000Z", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (content: unknown[], stopReason = "toolUse", extra: Record<string, unknown> = {}) => ({ type: "message", id: "a", message: { role: "assistant", stopReason, content, ...extra } });
const call = (name: string, args: Record<string, unknown>) => ({ type: "toolCall", id: `call-${name}`, name, arguments: args });
const result = (toolName: string, text: string, isError = false) => ({ type: "message", id: "r", message: { role: "toolResult", toolName, isError, content: [{ type: "text", text }] } });

const recentOnly: HandoffDigestLimits = { ...DEFAULT_HANDOFF_DIGEST_LIMITS, recentEntries: 1000 };

describe("handoffBranchDigest", () => {
  it("keeps the conversation, one line per recent tool call and result, and drops thinking", () => {
    const digest = handoffBranchDigest([
      user("Fix the login bug"),
      assistant([{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Reading the handler." }, call("read", { path: "src/login.ts" })]),
      result("read", "export function login() {}\n".repeat(50)),
      assistant([call("end_turn", { awaiting: "nothing", reply: "Fixed in src/login.ts." })]),
      result("end_turn", "No response requested."),
    ], recentOnly);

    expect(digest).toContain("[0] USER (2026-10-19T17:52Z)\nFix the login bug");
    expect(digest).toContain('[1] ASSISTANT\nReading the handler.\n→ read {"path":"src/login.ts"}');
    expect(digest).toMatch(/\[2\] ← read ok, 1350 chars: export function login/);
    expect(digest).toContain("[3] ASSISTANT\nFixed in src/login.ts.");
    expect(digest).not.toContain("private reasoning");
    expect(digest).not.toContain("end_turn");
    expect(digest).not.toContain("No response requested.");
  });

  it("clips long text and names the raw entry that holds the rest", () => {
    const digest = handoffBranchDigest([user("x".repeat(7000))], recentOnly);

    expect(digest).toContain(`${"x".repeat(6000)}… [clipped 1000 chars; full text in raw [0]]`);
  });

  it("folds older tool traffic into one line per run and keeps older replies and failures", () => {
    const limits: HandoffDigestLimits = { ...DEFAULT_HANDOFF_DIGEST_LIMITS, recentEntries: 1 };
    const digest = handoffBranchDigest([
      user("Look around"),
      assistant([{ type: "text", text: "Starting." }, call("bash", { command: "ls" })]),
      result("bash", "a b c"),
      assistant([call("read", { path: "a" }), call("read", { path: "b" })]),
      result("read", "missing", true),
      assistant([{ type: "text", text: "Here is what I found." }], "stop"),
      user("Thanks"),
    ], limits);

    expect(digest).toContain("[1] ASSISTANT\nStarting.\n\n[1–3] tools: bash, read×2\n\n[4] ← read ERROR\n\n[5] ASSISTANT\nHere is what I found.");
    expect(digest).not.toContain('"command":"ls"');
    expect(digest).not.toContain("a b c");
  });

  it("starts at the latest compaction summary and skips the entries it covers", () => {
    const digest = handoffBranchDigest([
      user("old request", "u0"),
      user("kept request", "u1"),
      { type: "compaction", id: "c", summary: "Earlier: the user asked for X.", firstKeptEntryId: "u1", tokensBefore: 1000 },
      user("new request", "u2"),
    ], recentOnly);

    expect(digest).not.toContain("old request");
    expect(digest).toContain("Entries before [1] are covered by the compaction summary at [2]");
    expect(digest.indexOf("Earlier: the user asked for X.")).toBeLessThan(digest.indexOf("kept request"));
    expect(digest.indexOf("kept request")).toBeLessThan(digest.indexOf("new request"));
  });

  it("omits the handoff's own status records and shows run failures", () => {
    const digest = handoffBranchDigest([
      { type: "custom_message", id: "s", customType: "forgerie.handoff.status", content: "Preparing handoff context.", display: true },
      { type: "custom_message", id: "p", customType: "forgerie.process-events", content: "server exited 1", display: true },
      assistant([], "error", { errorMessage: "overloaded" }),
    ], recentOnly);

    expect(digest).not.toContain("Preparing handoff context.");
    expect(digest).toContain("[1] forgerie.process-events\nserver exited 1");
    expect(digest).toContain("[2] ASSISTANT\n(run ended: error: overloaded)");
  });
});
