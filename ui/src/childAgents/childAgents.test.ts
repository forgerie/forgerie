import { describe, expect, it, vi } from "vitest";
import { fromHistory } from "../transcript";
import { childEntryOf, childLines, foldChildEntries, orderChildren, reportOf, CHILD_ANSWER_TYPE, CHILD_NOTE_TYPE, CHILD_QUESTION_TYPE } from "./childAgentsModel";
import { createChildAgentsStore } from "./childAgentsStore";
import { CHILDREN, STREAMING } from "./fixtures/children";

describe("child entries in the parent transcript", () => {
  it("reads questions, answers, notes, and reports", () => {
    expect(childEntryOf({ role: "custom", customType: CHILD_QUESTION_TYPE, details: { questionId: "q:1", child: 4, childName: "ui", question: "Blue?" } }))
      .toEqual({ kind: "question", questionId: "q:1", child: 4, childName: "ui", question: "Blue?" });
    expect(childEntryOf({ role: "custom", customType: CHILD_ANSWER_TYPE, details: { questionId: "q:1", answer: "Yes" } }))
      .toEqual({ kind: "answer", questionId: "q:1", answer: "Yes" });
    expect(childEntryOf({ role: "custom", customType: CHILD_NOTE_TYPE, details: { child: 4, childName: "ui", action: "message", text: "[the user told child ui directly] Faster" } }))
      .toEqual({ kind: "note", child: 4, childName: "ui", action: "message", text: "Faster" });
    expect(reportOf("[subagent api answered, no reply needed] Done.\nAll good.")).toEqual({ kind: "report", childName: "api", outcome: "answered", text: "Done.\nAll good." });
    expect(reportOf("[subagent api failed: rate limited]")).toEqual({ kind: "report", childName: "api", outcome: "failed", text: "rate limited" });
    expect(reportOf("a normal user message")).toBeUndefined();
    expect(childEntryOf({ role: "custom", customType: "other" })).toBeUndefined();
  });

  it("shows a report as a system row, not as something the user wrote", () => {
    const transcript = fromHistory([{ role: "user", content: "[subagent api answered, no reply needed] Done." }, { role: "user", content: "Thanks" }]);
    expect(transcript.messages.map((message) => [message.role, message.childEntry?.kind])).toEqual([["system", "report"], ["user", undefined]]);
  });

  it("moves an answer onto its question and drops the answer's row", () => {
    const messages = [
      { id: "1", childEntry: { kind: "question" as const, questionId: "q:1", child: 4, childName: "ui", question: "Blue?" } },
      { id: "2" },
      { id: "3", childEntry: { kind: "answer" as const, questionId: "q:1", answer: "Yes" } },
    ];
    expect(foldChildEntries(messages)).toEqual([{ ...messages[0], childEntry: { ...messages[0]!.childEntry, answer: "Yes" } }, { id: "2" }]);
    const unchanged: { id: string; childEntry?: undefined }[] = [{ id: "1" }];
    expect(foldChildEntries(unchanged)).toBe(unchanged);
  });
});

describe("the child view", () => {
  it("turns model messages into lines, with the streaming answer last", () => {
    expect(childLines(STREAMING).map((line) => [line.kind, line.kind === "said" ? line.who : line.name])).toEqual([
      ["said", "message"], ["tool", "read"], ["result", "read"], ["said", "child"],
    ]);
    expect(childLines(STREAMING).at(-1)).toMatchObject({ streaming: true });
  });

  it("puts children with questions first, then working ones", () => {
    expect(orderChildren(CHILDREN).map((child) => child.name)).toEqual(["ui", "api", "review"]);
  });
});

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("the child agents store", () => {
  it("reads the list once for a burst of changes", async () => {
    vi.useFakeTimers();
    const request = vi.fn((...args: [string, RequestInit]) => { void args; return respond(200, CHILDREN); });
    const store = createChildAgentsStore(request, () => ({ id: "s1", cwd: "/w" }), { refreshDelayMs: 10 });
    store.refresh(); store.refresh(); store.refresh();
    await vi.advanceTimersByTimeAsync(20);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe("/api/sessions/s1/children?cwd=%2Fw");
    expect(store.getSnapshot()).toMatchObject({ available: true, children: CHILDREN });
    store.dispose();
    vi.useRealTimers();
  });

  it("stops asking once the session hosts no children", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => respond(404, { error: "This session does not host child agents" }));
    const store = createChildAgentsStore(request, () => ({ id: "s1", cwd: "/w" }), { refreshDelayMs: 10 });
    store.refresh();
    await vi.advanceTimersByTimeAsync(20);
    store.refresh();
    await vi.advanceTimersByTimeAsync(20);
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().available).toBe(false);
    store.dispose();
    vi.useRealTimers();
  });

  it("posts an answer and keeps a refused one as an error", async () => {
    const request = vi.fn((path: string, init: RequestInit) => path.endsWith("/answer")
      ? JSON.parse(String(init.body)).answer === "bad" ? respond(409, { error: "Question q:1 is not open" }) : respond(200, { ok: true })
      : respond(200, []));
    const store = createChildAgentsStore(request, () => ({ id: "s1", cwd: "/w" }), { refreshDelayMs: 1 });
    await store.answer("q:1", "Teal");
    expect(JSON.parse(String(request.mock.calls[0]![1].body))).toEqual({ cwd: "/w", questionId: "q:1", answer: "Teal" });
    await expect(store.answer("q:1", "bad")).rejects.toThrow("is not open");
    expect(store.getSnapshot().error).toBe("Question q:1 is not open");
    store.dispose();
  });
});
