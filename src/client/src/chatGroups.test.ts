import { describe, expect, it } from "vitest";
import { chatTurns, foldMetaSources, groupChatMessages, latestChatResponseStart, summarizeChatGroup } from "./chatGroups";
import type { ChatLine } from "./components/shared";

const text = (role: ChatLine["role"], value: string): ChatLine => ({ role, parts: [{ type: "text", text: value }] });

describe("groupChatMessages", () => {
  it("pools a turn's technical parts into one group below its prose", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "toolCall", toolName: "read", summary: "file" }] },
      text("assistant", "visible answer"),
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }] },
    ];

    expect(groupChatMessages(messages, 10)).toEqual([
      { kind: "message", index: 11, message: text("assistant", "visible answer") },
      { kind: "group", startIndex: 10, endIndex: 12, messages: [messages[0], messages[2]] },
    ]);
  });

  it("starts a new pool at each human turn", () => {
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
      { kind: "message", index: 2, message: text("assistant", "partway") },
      { kind: "message", index: 4, message: text("assistant", "answer") },
      { kind: "group", startIndex: 1, endIndex: 3, messages: [messages[1], messages[3]] },
      { kind: "message", index: 5, message: text("user", "second question") },
      { kind: "message", index: 7, message: text("assistant", "second answer") },
      { kind: "group", startIndex: 6, endIndex: 6, messages: [messages[6]] },
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

  it("splits mixed readable and technical parts from a single message", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }] } },
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "hidden" }] }] },
    ]);
  });

  it("keeps skill reads out of event groups", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "message", index: 0, message: { role: "skill", parts: [{ type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] } },
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "plan" }] }] },
    ]);
  });

  it("keeps image content visible outside collapsed event groups", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "QUJD" };
    const messages: ChatLine[] = [
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }, image] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image] }, toolName: "read" },
      {
        kind: "group",
        startIndex: 0,
        endIndex: 0,
        messages: [{ role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }] }],
      },
    ]);
  });

  it("preserves image metadata when splitting technical and readable parts", () => {
    const meta = { timestamp: "2026-07-13T22:00:00.000Z" };
    const image = { type: "image" as const, mimeType: "image/webp", data: "QUJD" };
    const message: ChatLine = { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }, image], meta };

    expect(groupChatMessages([message])).toEqual([
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image], meta }, toolName: "read" },
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "tool", parts: [message.parts[0]], meta }] },
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
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }], meta: message.meta } },
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ role: "assistant", parts: [{ type: "thinking", text: "hidden" }], meta: message.meta }] },
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
    ], 8).at(-1)).toMatchObject({ kind: "group", startIndex: 8, endIndex: 9 });
  });
});

describe("foldMetaSources", () => {
  const call = (summary: string): ChatLine => ({ role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary }] });

  it("gives a fold the reply that ended its turn", () => {
    const closing = text("assistant", "answer");
    const groups = groupChatMessages([
      text("user", "question"),
      call("a"),
      text("assistant", "partway"),
      call("b"),
      closing,
    ]);

    const sources = foldMetaSources(groups);

    expect(sources.size).toBe(1);
    expect([...sources.values()][0]).toEqual(closing);
  });

  it("keeps each turn's fold on its own reply", () => {
    const groups = groupChatMessages([
      text("user", "first"),
      call("a"),
      text("assistant", "first answer"),
      text("user", "second"),
      call("b"),
      text("assistant", "second answer"),
    ]);

    expect([...foldMetaSources(groups).values()]).toEqual([
      text("assistant", "first answer"),
      text("assistant", "second answer"),
    ]);
  });

  it("leaves a fold unstamped when the turn produced no reply", () => {
    expect(foldMetaSources(groupChatMessages([text("user", "question"), call("a")])).size).toBe(0);
  });

  it("does not stamp a history fold with a reply's model", () => {
    const groups = groupChatMessages([
      text("user", "question"),
      text("assistant", "answer"),
      { ...text("assistant", "summary"), source: "compaction" },
    ]);

    expect(foldMetaSources(groups).size).toBe(0);
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
          { kind: "message", index: 2, message: text("assistant", "first answer") },
          { kind: "group", startIndex: 1, endIndex: 1, messages: [call("a")] },
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

describe("latestChatResponseStart", () => {
  it("selects the first rendered agent content in the newest complete turn", () => {
    const groups = groupChatMessages([
      text("user", "first question"),
      text("assistant", "first answer"),
      text("user", "latest question"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect" }] },
      text("assistant", "latest answer"),
    ]);

    expect(latestChatResponseStart(groups)).toEqual({
      turn: chatTurns(groups)[1],
      group: { kind: "message", index: 4, message: text("assistant", "latest answer") },
    });
  });

  it("does not treat technical-only activity as an agent answer", () => {
    const groups = groupChatMessages([
      text("user", "question"),
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect" }] },
    ]);

    expect(latestChatResponseStart(groups)).toBeUndefined();
  });

  it("waits when the loaded history begins inside a response", () => {
    const groups = groupChatMessages([text("assistant", "partial loaded answer")], 100);

    expect(latestChatResponseStart(groups)).toBeUndefined();
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
