import { describe, expect, it } from "vitest";
import { chatTurnFlow, chatTurns, groupChatMessages, latestChatTurnStart, summarizeChatGroup, turnMetaSource } from "./chatGroups";
import type { ChatLine } from "./components/shared";

const text = (role: ChatLine["role"], value: string): ChatLine => ({ role, parts: [{ type: "text", text: value }] });

describe("groupChatMessages", () => {
  it("closes the pending step cluster the moment prose appears", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "toolCall", toolName: "read", summary: "file" }] },
      text("assistant", "visible answer"),
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }] },
    ];

    expect(groupChatMessages(messages, 10)).toEqual([
      { kind: "group", startIndex: 10, endIndex: 10, messages: [messages[0]] },
      { kind: "message", index: 11, message: text("assistant", "visible answer") },
      { kind: "group", startIndex: 12, endIndex: 12, messages: [messages[2]] },
    ]);
  });

  it("interleaves step clusters with prose in the order they happened", () => {
    const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });
    const messages: ChatLine[] = [
      text("user", "first question"),
      call("a"),
      text("assistant", "partway"),
      call("b"),
      text("assistant", "answer"),
      text("user", "second question"),
      call("c"),
      text("assistant", "second answer"),
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "message", index: 0, message: text("user", "first question") },
      { kind: "group", startIndex: 1, endIndex: 1, messages: [messages[1]] },
      { kind: "message", index: 2, message: text("assistant", "partway") },
      { kind: "group", startIndex: 3, endIndex: 3, messages: [messages[3]] },
      { kind: "message", index: 4, message: text("assistant", "answer") },
      { kind: "message", index: 5, message: text("user", "second question") },
      { kind: "group", startIndex: 6, endIndex: 6, messages: [messages[6]] },
      { kind: "message", index: 7, message: text("assistant", "second answer") },
    ]);
  });

  it("treats a human shell command as the start of a turn", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "a" }] },
      text("bash", "ls"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "b" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [messages[0]] },
      { kind: "message", index: 1, message: text("bash", "ls") },
      { kind: "group", startIndex: 2, endIndex: 2, messages: [messages[2]] },
    ]);
  });

  it("keeps history summaries in their own group, not pooled with steps", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "a" }] },
      { ...text("assistant", "summary"), source: "compaction" },
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "b" }] },
    ];

    const groups = groupChatMessages(messages);
    const history = groups[1];

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "group", startIndex: 0, endIndex: 0 });
    expect(groups[2]).toMatchObject({ kind: "group", startIndex: 2, endIndex: 2 });
    if (history?.kind !== "group") throw new Error("expected a history group");
    expect(summarizeChatGroup(history.messages)).toBe("1 history compaction summary");
  });

  it("splits mixed readable and technical parts on part order", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }] },
    ];

    // The thinking preceded the sentence, so its fold sits above the prose.
    expect(groupChatMessages(messages)).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "hidden" }] }] },
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }] } },
    ]);
  });

  it("folds a sentence's own tool calls below it", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "text", text: "let me look" }, { type: "toolCall", toolName: "read", summary: "file" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "let me look" }] } },
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "file" }] }] },
    ]);
  });

  // A skill read is machinery the turn ran through, not something the turn
  // said, so it pools into the fold with the rest of the steps instead of
  // standing in the transcript under its own role label.
  it("pools skill reads into the event group", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] } ] },
    ]);
  });

  // Same reasoning for background-process notifications: they are events the
  // turn ran through, and a card per event buried the transcript.
  it("pools process notifications into the event group", () => {
    const notification = { type: "processNotification" as const, kind: "failure" as const, processName: "worker", summary: "Process \"worker\" failed.", exitCode: 1, rawContent: "raw" };
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "text", text: "on it" }] },
      { role: "system", parts: [notification] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "on it" }] } },
      { kind: "group", startIndex: 1, endIndex: 1, messages: [{ role: "system", parts: [notification] }] },
    ]);
  });

  it("keeps image content visible outside collapsed event groups", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "QUJD" };
    const messages: ChatLine[] = [
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }, image] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      {
        kind: "group",
        startIndex: 0,
        endIndex: 0,
        messages: [{ role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }] }],
      },
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image] }, toolName: "read" },
    ]);
  });

  it("preserves image metadata when splitting technical and readable parts", () => {
    const meta = { timestamp: "2026-07-13T22:00:00.000Z" };
    const image = { type: "image" as const, mimeType: "image/webp", data: "QUJD" };
    const message: ChatLine = { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }, image], meta };

    expect(groupChatMessages([message])).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "tool", parts: [message.parts[0]], meta }] },
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image], meta }, toolName: "read" },
    ]);
  });

  it("keeps user images as ordinary messages", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "QUJD" };
    const message: ChatLine = { role: "user", parts: [image] };

    expect(groupChatMessages([message])).toEqual([
      { kind: "message", index: 0, message },
    ]);
  });

  it("preserves message metadata when grouping", () => {
    const message: ChatLine = { role: "assistant", parts: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }], meta: { timestamp: "2026-05-09T12:00:00.000Z", model: { provider: "test", id: "model" } } };

    expect(groupChatMessages([message])).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "hidden" }], meta: message.meta }] },
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }], meta: message.meta } },
    ]);
  });

  it("treats compaction and branch summaries as grouped events", () => {
    const messages: ChatLine[] = [
      { ...text("assistant", "summary"), source: "compaction" },
      { ...text("assistant", "branch"), source: "branch_summary" },
    ];

    const groups = groupChatMessages(messages);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "group", startIndex: 0, endIndex: 1 });
  });

  it("keeps a stable group end index when older events are prepended into a group", () => {
    expect(groupChatMessages([
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "older", isError: false }] },
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "newer" }] },
      text("assistant", "answer"),
    ], 8).at(0)).toMatchObject({ kind: "group", startIndex: 8, endIndex: 9 });
  });
});

describe("chatTurns", () => {
  const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });

  it("opens a turn at each human message and keeps the reply with it", () => {
    const groups = groupChatMessages([
      text("user", "first question"),
      call("a"),
      text("assistant", "first answer"),
      text("user", "second question"),
      text("assistant", "second answer"),
    ]);

    expect(chatTurns(groups)).toEqual([
      {
        openedByIndex: 0,
        groups: [
          { kind: "message", index: 0, message: text("user", "first question") },
          { kind: "group", startIndex: 1, endIndex: 1, messages: [call("a")] },
          { kind: "message", index: 2, message: text("assistant", "first answer") },
        ],
      },
      {
        openedByIndex: 3,
        groups: [
          { kind: "message", index: 3, message: text("user", "second question") },
          { kind: "message", index: 4, message: text("assistant", "second answer") },
        ],
      },
    ]);
  });

  it("treats a bash message as a human turn", () => {
    const turns = chatTurns(groupChatMessages([text("bash", "ls"), text("assistant", "listing")]));

    expect(turns).toHaveLength(1);
    expect(turns[0]?.openedByIndex).toBe(0);
  });

  it("carries groups that precede the first human message in an unopened turn", () => {
    const turns = chatTurns(groupChatMessages([
      { ...text("assistant", "summary"), source: "compaction" },
      text("user", "question"),
    ]));

    expect(turns).toHaveLength(2);
    expect(turns[0]?.openedByIndex).toBeUndefined();
    expect(turns[0]?.groups).toHaveLength(1);
    expect(turns[1]?.openedByIndex).toBe(1);
  });

  it("returns no turns for an empty transcript", () => {
    expect(chatTurns([])).toEqual([]);
  });
});

describe("chatTurnFlow", () => {
  const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });

  const turnOf = (messages: ChatLine[]) => {
    const turn = chatTurns(groupChatMessages(messages)).at(-1);
    if (turn === undefined) throw new Error("expected a turn");
    return turn;
  };

  it("splits a closed turn into opener, work, and answer", () => {
    const turn = turnOf([
      text("user", "question"),
      call("a"),
      text("assistant", "partway"),
      call("b"),
      text("assistant", "answer"),
    ]);

    const flow = chatTurnFlow(turn, true);

    expect(flow.opener).toMatchObject({ kind: "message", index: 0 });
    expect(flow.work).toEqual([
      expect.objectContaining({ kind: "group", startIndex: 1 }),
      expect.objectContaining({ kind: "message", index: 2 }),
      expect.objectContaining({ kind: "group", startIndex: 3 }),
    ]);
    expect(flow.answer).toMatchObject({ kind: "message", index: 4 });
    expect(flow.continuation).toEqual([]);
  });

  it("keeps the trailing prose in the work while the turn is open", () => {
    const turn = turnOf([text("user", "question"), call("a"), text("assistant", "so far")]);

    const flow = chatTurnFlow(turn, false);

    expect(flow.answer).toBeUndefined();
    expect(flow.work.at(-1)).toMatchObject({ kind: "message", index: 2 });
    expect(flow.continuation).toEqual([]);
  });

  it("keeps the previous settled prose promoted while newer prose streams", () => {
    const turn = turnOf([
      text("user", "question"),
      text("assistant", "previous answer"),
      call("a"),
      text("assistant", "new answer streaming"),
    ]);

    const flow = chatTurnFlow(turn, false);

    expect(flow.work).toEqual([]);
    expect(flow.answer).toMatchObject({ kind: "message", index: 1 });
    expect(flow.continuation).toEqual([
      expect.objectContaining({ kind: "group", startIndex: 2 }),
      expect.objectContaining({ kind: "message", index: 3 }),
    ]);
  });

  it("keeps the latest assistant prose promoted while later tool work runs", () => {
    const turn = turnOf([text("user", "question"), text("assistant", "the answer"), call("a")]);

    const flow = chatTurnFlow(turn, false);

    expect(flow.answer).toMatchObject({ kind: "message", index: 1 });
    expect(flow.work).toEqual([]);
    expect(flow.continuation).toEqual([expect.objectContaining({ kind: "group", startIndex: 2 })]);
  });

  it("keeps the latest assistant prose promoted before a question card", () => {
    const record = { askId: "ask-1", reason: "submitted" as const, askedAt: "t", closedAt: "t", questions: [], answeredCount: 0, unansweredIds: [], summary: "s" };
    const turn = turnOf([
      text("user", "question"),
      text("assistant", "the answer"),
      { role: "assistant", parts: [{ type: "askUserRecord", outcome: record }] },
    ]);

    const flow = chatTurnFlow(turn, false);

    expect(flow.answer).toMatchObject({ kind: "message", index: 1 });
    expect(flow.work).toEqual([]);
    expect(flow.continuation).toEqual([expect.objectContaining({ kind: "message", index: 2 })]);
  });

  it("keeps the latest assistant prose promoted while history compacts", () => {
    const turn = turnOf([
      text("user", "question"),
      text("assistant", "the answer"),
      { ...text("assistant", "summary"), source: "compaction" },
    ]);

    const flow = chatTurnFlow(turn, false);

    expect(flow.answer).toMatchObject({ kind: "message", index: 1 });
    expect(flow.work).toEqual([]);
    expect(flow.continuation).toEqual([expect.objectContaining({ kind: "group", startIndex: 2 })]);
  });

  it("reads a windowed turn with no loaded opener as all work", () => {
    const turn = chatTurns(groupChatMessages([text("assistant", "tail of an older reply")], 40)).at(-1);
    if (turn === undefined) throw new Error("expected a turn");

    const flow = chatTurnFlow(turn, true);

    expect(flow.opener).toBeUndefined();
    expect(flow.answer).toMatchObject({ kind: "message", index: 40 });
    expect(flow.work).toEqual([]);
    expect(flow.continuation).toEqual([]);
  });
});

describe("turnMetaSource", () => {
  const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });

  it("returns the reply that closed the turn", () => {
    const closing: ChatLine = { ...text("assistant", "answer"), meta: { timestamp: "2026-08-20T10:00:00.000Z" } };
    const turn = chatTurns(groupChatMessages([text("user", "question"), call("a"), text("assistant", "partway"), closing])).at(-1);
    if (turn === undefined) throw new Error("expected a turn");

    expect(turnMetaSource(turn)).toEqual(closing);
  });

  it("returns nothing for a turn without a reply", () => {
    const turn = chatTurns(groupChatMessages([text("user", "question"), call("a")])).at(-1);
    if (turn === undefined) throw new Error("expected a turn");

    expect(turnMetaSource(turn)).toBeUndefined();
  });
});

describe("latestChatTurnStart", () => {
  it("selects the human opener of the newest turn", () => {
    const groups = groupChatMessages([
      text("user", "first question"),
      text("assistant", "first answer"),
      text("user", "latest question"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect" }] },
      text("assistant", "latest answer"),
    ]);

    expect(latestChatTurnStart(groups)).toEqual({
      turn: chatTurns(groups)[1],
      group: { kind: "message", index: 2, message: text("user", "latest question") },
    });
  });

  it("selects the turn opener before the agent has answered", () => {
    const groups = groupChatMessages([
      text("user", "question"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect" }] },
    ]);

    expect(latestChatTurnStart(groups)).toEqual({
      turn: chatTurns(groups)[0],
      group: { kind: "message", index: 0, message: text("user", "question") },
    });
  });

  it("waits when the loaded history begins inside a response", () => {
    const groups = groupChatMessages([text("assistant", "partial loaded answer")], 100);

    expect(latestChatTurnStart(groups)).toBeUndefined();
  });
});

describe("summarizeChatGroup", () => {
  it("summarizes special event groups", () => {
    expect(summarizeChatGroup([{ ...text("assistant", "a"), source: "compaction" }])).toBe("1 history compaction summary");
    expect(summarizeChatGroup([
      { ...text("assistant", "a"), source: "branch_summary" },
      { ...text("assistant", "b"), source: "branch_summary" },
    ])).toBe("2 branch summaries");
  });

  it("reports a mixed group as a single step count, not a role breakdown", () => {
    expect(summarizeChatGroup([text("tool", "a"), text("system", "b"), text("tool", "c")])).toBe("3 steps");
  });

  it("keeps the step count singular for a lone step", () => {
    expect(summarizeChatGroup([text("tool", "a")])).toBe("1 step");
  });
});
