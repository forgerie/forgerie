import { describe, expect, it, vi } from "vitest";
import { AD_PROCESS_NOTIFICATION_CUSTOM_TYPE, ASK_USER_ANSWERS_CUSTOM_TYPE, type AskUserOutcome } from "../../shared/apiTypes";
import { groupChatMessages } from "./chatGroups";
import { appendText, appendThinking, normalizeMessage, normalizeMessages, normalizeMessagesCooperatively, textMessage } from "./chatMessages";
import { ControllableChatNormalizationScheduler } from "./chatMessages.testSupport";

const askUserOutcome: AskUserOutcome = {
  askId: "ask-1",
  reason: "submitted",
  askedAt: "2026-07-20T10:00:00.000Z",
  closedAt: "2026-07-20T10:05:00.000Z",
  questions: [
    {
      question: { id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] },
      answered: true,
      values: ["pg"],
    },
    {
      question: { id: "cache", question: "Which cache?", options: [{ value: "redis", label: "Redis" }] },
      answered: false,
      values: [],
    },
  ],
  answeredCount: 1,
  unansweredIds: ["cache"],
  summary: "Answered 1 of 2; unanswered: cache",
};

const supersededAskUserOutcome: AskUserOutcome = {
  ...askUserOutcome,
  reason: "superseded",
  questions: askUserOutcome.questions.map((record) => ({ question: record.question, answered: false, values: [] })),
  answeredCount: 0,
  unansweredIds: ["db", "cache"],
  summary: "Answered 0 of 2; unanswered: db, cache",
};

describe("chat message normalization", () => {
  it("normalizes simple text messages and drops empty content", () => {
    expect(normalizeMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },
      { role: "unknown", content: "system text" },
    ])).toEqual([
      textMessage("user", "hello"),
      textMessage("system", "system text"),
    ]);
  });

  it("preserves already-normalized chat lines", () => {
    const line = { role: "assistant" as const, parts: [{ type: "text" as const, text: "cached" }] };

    expect(normalizeMessage(line)).toEqual([line]);
    expect(normalizeMessages([{ role: "user", content: "raw" }, line])).toEqual([textMessage("user", "raw"), line]);
  });

  it("yields during large normalization while preserving the synchronous result", async () => {
    const scheduler = new ControllableChatNormalizationScheduler();
    const messages = [
      { role: "user", content: "run the tool" },
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "file" }] },
      { role: "assistant", content: "done" },
    ];

    const normalized = await normalizeMessagesCooperatively(messages, { budgetMs: 5, scheduler });

    expect(normalized).toEqual({ kind: "normalized", messages: normalizeMessages(messages) });
    expect(scheduler.yieldCount).toBeGreaterThan(0);
  });

  it("stops cooperative normalization after its work is superseded", async () => {
    const scheduler = new ControllableChatNormalizationScheduler({ pauseFirstYield: true });
    let current = true;
    const normalizing = normalizeMessagesCooperatively([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "assistant", content: "three" },
    ], { budgetMs: 5, scheduler, shouldContinue: () => current });
    await vi.waitFor(() => { expect(scheduler.yieldCount).toBe(1); });

    current = false;
    scheduler.release();

    await expect(normalizing).resolves.toEqual({ kind: "superseded" });
    expect(scheduler.yieldCount).toBe(1);
  });

  it("projects ask_user answer messages into visible read-only record parts", () => {
    const normalized = normalizeMessage({
      role: "custom",
      customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
      content: "model-facing answer text",
      details: askUserOutcome,
    });
    const recordLine = { role: "system" as const, parts: [{ type: "askUserRecord" as const, outcome: askUserOutcome }] };

    expect(normalized).toEqual([recordLine]);
    expect(groupChatMessages(normalized)).toEqual([{ kind: "message", index: 0, message: recordLine }]);
  });

  it("falls back to model-facing text when an ask_user answer record is malformed", () => {
    expect(normalizeMessage({
      role: "custom",
      customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
      content: "Answered 0 of 1; unanswered: db",
      details: { askId: "missing-the-rest" },
    })).toEqual([textMessage("system", "Answered 0 of 1; unanswered: db")]);
  });

  it("projects a superseded ask from the later ask_user tool result", () => {
    const normalized = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "ask-call", name: "ask_user", arguments: { questions: [] } }] },
      {
        role: "toolResult",
        toolCallId: "ask-call",
        toolName: "ask_user",
        content: [{ type: "text", text: "Posted a newer question set." }],
        details: { ask: { askId: "ask-2" }, superseded: supersededAskUserOutcome },
        isError: false,
      },
    ]);

    expect(normalized[1]).toEqual({ role: "tool", parts: [{ type: "askUserRecord", outcome: supersededAskUserOutcome }] });
    expect(groupChatMessages(normalized).map((group) => group.kind)).toEqual(["group", "message"]);
  });

  it("normalizes tool calls and tool results", () => {
    expect(normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "npm test" } }] })).toEqual([
      { role: "assistant", parts: [{ type: "toolCall", toolName: "bash", summary: "npm test", args: { command: "npm test" } }] },
    ]);
    expect(normalizeMessage({ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "failed" }] })).toEqual([
      { role: "tool", parts: [{ type: "toolResult", toolName: "bash", text: "failed", content: [{ type: "text", text: "failed" }], isError: true }] },
    ]);
  });

  it("normalizes image content into image parts", () => {
    expect(normalizeMessage({ role: "user", content: [{ type: "text", text: "see this" }, { type: "image", mimeType: "image/png", data: "QUJD" }] })).toEqual([
      { role: "user", parts: [{ type: "text", text: "see this" }, { type: "image", mimeType: "image/png", data: "QUJD" }] },
    ]);
  });

  it("falls back to a placeholder for image content without data", () => {
    expect(normalizeMessage({ role: "user", content: [{ type: "image", mimeType: "image/png" }] })).toEqual([
      { role: "user", parts: [{ type: "text", text: "[image]" }] },
    ]);
  });

  it("carries the thinking level into assistant message metadata", () => {
    expect(normalizeMessage({ role: "assistant", content: [{ type: "text", text: "hi" }], provider: "openai", model: "gpt-4.1", timestamp: "2026-05-09T12:00:00.000Z", thinkingLevel: "max" })).toEqual([
      { role: "assistant", parts: [{ type: "text", text: "hi" }], meta: { timestamp: "2026-05-09T12:00:00.000Z", model: { provider: "openai", id: "gpt-4.1" }, thinkingLevel: "max" } },
    ]);
  });

  it("shows assistant model errors as system chat messages", () => {
    expect(normalizeMessage({ role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate limit", timestamp: "2026-05-09T12:00:00.000Z", provider: "openai", model: "gpt-4.1" })).toEqual([
      { role: "system", parts: [{ type: "text", text: "Model response failed: 429 rate limit" }], meta: { timestamp: "2026-05-09T12:00:00.000Z", model: { provider: "openai", id: "gpt-4.1" } } },
    ]);
  });

  it("keeps partial assistant content and adds a visible error line", () => {
    expect(normalizeMessage({ role: "assistant", content: [{ type: "text", text: "partial answer" }], stopReason: "error", errorMessage: "connection lost" })).toEqual([
      textMessage("assistant", "partial answer"),
      textMessage("system", "Model response failed: connection lost"),
    ]);
  });

  it("keeps a skill invocation and its argument in the one message that was typed", () => {
    const promptText = "<skill name=\"playwright\" location=\"/skills/playwright\">\nUse browser\n</skill>\n\nNow test the UI";

    expect(normalizeMessage({ role: "user", content: promptText })).toEqual([
      { role: "user", parts: [{ type: "skillInvocation", name: "playwright", location: "/skills/playwright", content: "Use browser", argument: "Now test the UI" }], promptText },
    ]);
  });

  it("leaves the argument off a skill invoked without one", () => {
    const promptText = "<skill name=\"playwright\" location=\"/skills/playwright\">\nUse browser\n</skill>";

    expect(normalizeMessage({ role: "user", content: promptText })).toEqual([
      { role: "user", parts: [{ type: "skillInvocation", name: "playwright", location: "/skills/playwright", content: "Use browser" }], promptText },
    ]);
  });

  it("normalizes skill reads into skill chat lines", () => {
    expect(normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "/home/user/.agents/skills/playwright/SKILL.md" } }] })).toEqual([
      { role: "skill", parts: [{ type: "skillRead", name: "playwright", path: "/home/user/.agents/skills/playwright/SKILL.md" }] },
    ]);
  });

  it("pairs tool calls and results into execution cards when normalizing history", () => {
    expect(normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/app.ts", edits: [{ oldText: "old", newText: "new" }] } }] },
      { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "ok" }], details: { diff: "-1 old\n+1 new" }, isError: false },
    ])).toEqual([
      {
        role: "tool",
        parts: [{
          type: "toolExecution",
          toolCallId: "edit-1",
          toolName: "edit",
          summary: "src/app.ts",
          args: { path: "src/app.ts", edits: [{ oldText: "old", newText: "new" }] },
          status: "success",
          resultText: "ok",
          content: [{ type: "text", text: "ok" }],
          details: { diff: "-1 old\n+1 new" },
        }],
      },
    ]);
  });

  it("keeps history-backed positions stable when earlier normalized messages are prepended", () => {
    const toolCall = { role: "assistant", content: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/app.ts" } }] };
    const toolResult = { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "ok" }], isError: false };
    const user = { role: "user", content: "continue" };
    const tail = normalizeMessages([toolCall, toolResult, user], 10);
    const expanded = normalizeMessages([
      { role: "user", content: "older" },
      { role: "assistant", content: "history" },
      toolCall,
      toolResult,
      user,
    ], 8);

    expect(tail.map((line) => line.transcriptPosition)).toEqual([
      { messageIndex: 10, lineIndex: 0, segmentIndex: 0 },
      { messageIndex: 12, lineIndex: 0, segmentIndex: 0 },
    ]);
    expect(expanded.slice(-2).map((line) => line.transcriptPosition)).toEqual(tail.map((line) => line.transcriptPosition));
  });

  it("preserves a history-backed position while live text and thinking append", () => {
    const textLine = normalizeMessages([{ role: "assistant", content: "hel" }], 4);
    const completedText = appendText(textLine, "assistant", "lo");
    expect(completedText[0]?.transcriptPosition).toEqual({ messageIndex: 4, lineIndex: 0, segmentIndex: 0 });

    const thinkingLine = normalizeMessages([{ role: "assistant", content: [{ type: "thinking", thinking: "pla" }] }], 5);
    const completedThinking = appendThinking(thinkingLine, "n");
    expect(completedThinking[0]?.transcriptPosition).toEqual({ messageIndex: 5, lineIndex: 0, segmentIndex: 0 });
  });

  it("formats bash execution records as bash chat lines", () => {
    expect(normalizeMessage({
      role: "bashExecution",
      command: "npm test",
      excludeFromContext: true,
      output: "ok",
      exitCode: 0,
      truncated: true,
      fullOutputPath: "/tmp/out.log",
    })).toEqual([
      textMessage("bash", "excluded from context\n\n$ npm test\n\nok\n\nexit 0\n\noutput truncated\n\nfull output: /tmp/out.log"),
    ]);
  });
});


describe("process notification projection", () => {
  // Surveyed installed extension sources before pinning this projection. Only
  // pi-processes currently emits a displayed custom message type that needs a
  // browser renderer: \`ad-process:notification\` (v0.10.4).
  const details = {
    kind: "crash",
    processId: "process-1",
    processName: "web-server",
    command: "node server.js",
    timestamp: 1_722_960_000_000,
    summary: "Process crashed with exit code 1",
    status: "exited",
    exitCode: 1,
    endReason: "exit",
    signal: null,
    attention: "turn",
  };

  it("projects a process notification into a step pooled with the turn's fold", () => {
    const rawContent = '<process_notification kind="crash">verbose XML</process_notification>';
    const normalized = normalizeMessage({
      role: "custom",
      customType: AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
      content: rawContent,
      details,
    });
    const recordLine = {
      role: "system" as const,
      parts: [{
        type: "processNotification" as const,
        kind: "crash",
        processName: "web-server",
        summary: "Process crashed with exit code 1",
        status: "exited",
        exitCode: 1,
        rawContent,
      }],
    };

    expect(normalized).toEqual([recordLine]);
    expect(groupChatMessages(normalized)).toEqual([{ kind: "group", startIndex: 0, endIndex: 0, messages: [recordLine] }]);
  });

  it("accepts a log-match notification without lifecycle fields", () => {
    const normalized = normalizeMessage({
      role: "custom",
      customType: AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
      content: "raw",
      details: {
        kind: "log_match",
        processId: "process-2",
        processName: "dev-server",
        command: "npm run dev",
        timestamp: 1_722_960_000_000,
        summary: "Server listening on port 3000",
        attention: "context",
      },
    });

    expect(normalized[0]?.parts[0]).toEqual({
      type: "processNotification",
      kind: "log_match",
      processName: "dev-server",
      summary: "Server listening on port 3000",
      rawContent: "raw",
    });
  });

  it("normalizes a null exit code to an omitted display field", () => {
    const normalized = normalizeMessage({
      role: "custom",
      customType: AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
      content: "raw",
      details: { ...details, exitCode: null },
    });

    expect(normalized[0]?.parts[0]).not.toHaveProperty("exitCode");
  });

  it("accepts suppressed log-match summaries", () => {
    const normalized = normalizeMessage({
      role: "custom",
      customType: AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
      content: "raw",
      details: { ...details, kind: "log_match_suppressed" },
    });

    expect(normalized[0]?.parts[0]).toMatchObject({
      type: "processNotification",
      kind: "log_match_suppressed",
    });
  });

  it.each([
    null,
    {},
    { ...details, summary: "" },
    { ...details, kind: "unknown" },
    { ...details, exitCode: "1" },
  ])("falls back to raw text for malformed details %#", (malformedDetails) => {
    expect(normalizeMessage({
      role: "custom",
      customType: AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
      content: "raw process notification",
      details: malformedDetails,
    })).toEqual([textMessage("system", "raw process notification")]);
  });

  it("does not project an unknown custom message type by details shape", () => {
    expect(normalizeMessage({
      role: "custom",
      customType: "another-extension:notification",
      content: "raw custom message",
      details,
    })).toEqual([textMessage("system", "raw custom message")]);
  });
});

describe("appendText", () => {
  it("appends to the previous same-role text message", () => {
    expect(appendText([textMessage("assistant", "hello")], "assistant", " world")).toEqual([
      textMessage("assistant", "hello world"),
    ]);
  });

  it("starts a new message when role does not match", () => {
    expect(appendText([textMessage("user", "hello")], "assistant", "hi")).toEqual([
      textMessage("user", "hello"),
      textMessage("assistant", "hi"),
    ]);
  });

  it("adds a text part to the previous same-role non-text message", () => {
    expect(appendText([{ role: "assistant", parts: [{ type: "thinking", text: "plan" }] }], "assistant", "answer")).toEqual([
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "answer" }] },
    ]);
  });
});

describe("appendThinking", () => {
  it("appends thinking deltas to the previous assistant thinking part", () => {
    expect(appendThinking([{ role: "assistant", parts: [{ type: "thinking", text: "pla" }] }], "n")).toEqual([
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }] },
    ]);
  });

  it("adds a thinking part to the previous assistant message", () => {
    expect(appendThinking([textMessage("assistant", "answer")], "plan")).toEqual([
      { role: "assistant", parts: [{ type: "text", text: "answer" }, { type: "thinking", text: "plan" }] },
    ]);
  });
});
