import { describe, expect, it } from "vitest";
import { noAsk, reduceAskEvent, resyncAsk, whileOpen, type AskState } from "./ask";
import { chooseOther, blankDraft, isAnswered, pickOption, toAnswers, writeOther } from "./askDraft";
import type { AskQuestion, PendingAsk } from "./contracts";

const one: AskQuestion = { id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }, { value: "lite", label: "SQLite" }] };
const many: AskQuestion = { id: "checks", question: "Which checks?", options: [{ value: "lint", label: "Lint" }, { value: "test", label: "Test" }], multiple: true };
const ask = (askId: string): PendingAsk => ({ askId, askedAt: "2026-09-29T00:00:00Z", questions: [one, many] });

describe("ask state", () => {
  it("opens, ignores a repeated open, and closes only the named ask", () => {
    let state: AskState = reduceAskEvent(noAsk, { type: "ask.opened", ask: ask("a") });
    state = whileOpen(state, "a", (open) => ({ ...open, phase: { type: "sending", action: "submit" } }));
    expect(reduceAskEvent(state, { type: "ask.opened", ask: ask("a") })).toBe(state);
    expect(reduceAskEvent(state, { type: "ask.closed", askId: "old", reason: "superseded" })).toBe(state);
    expect(reduceAskEvent(state, { type: "ask.closed", askId: "a", reason: "submitted" })).toEqual(noAsk);
  });
  it("replaces a superseded ask with a fresh form phase", () => {
    const sending = whileOpen(reduceAskEvent(noAsk, { type: "ask.opened", ask: ask("a") }), "a",
      (open) => ({ ...open, phase: { type: "sending", action: "dismiss" } }));
    expect(reduceAskEvent(sending, { type: "ask.opened", ask: ask("b") })).toEqual({ type: "open", ask: ask("b"), phase: { type: "answering" } });
  });
  it("resyncs from status: keeps the same ask, adopts a new one, and clears a closed one", () => {
    const open = reduceAskEvent(noAsk, { type: "ask.opened", ask: ask("a") });
    expect(resyncAsk(open, ask("a"))).toBe(open);
    expect(resyncAsk(open, ask("b"))).toMatchObject({ ask: { askId: "b" } });
    expect(resyncAsk(open, undefined)).toEqual(noAsk);
    expect(whileOpen(noAsk, "a", () => open)).toEqual(noAsk);
  });
});

describe("ask drafts", () => {
  it("replaces a single choice and moves between an option and an own answer without losing text", () => {
    let draft = pickOption(one, blankDraft, "pg");
    draft = pickOption(one, draft, "lite");
    expect(draft.values).toEqual(["lite"]);
    draft = writeOther(one, draft, "MySQL");
    expect(draft).toEqual({ values: [], other: "MySQL", otherChosen: true });
    draft = pickOption(one, draft, "pg");
    expect(draft).toEqual({ values: ["pg"], other: "MySQL", otherChosen: false });
    draft = chooseOther(one, draft, true);
    expect(draft).toEqual({ values: [], other: "MySQL", otherChosen: true });
  });
  it("toggles several choices alongside an own answer", () => {
    let draft = pickOption(many, blankDraft, "lint");
    draft = pickOption(many, draft, "test");
    draft = pickOption(many, draft, "lint");
    draft = writeOther(many, draft, "typecheck");
    expect(draft).toEqual({ values: ["test"], other: "typecheck", otherChosen: true });
    expect(chooseOther(many, draft, false).values).toEqual(["test"]);
  });
  it("counts blank own answers as unanswered and sends answers in question order", () => {
    expect(isAnswered(writeOther(one, blankDraft, "   "))).toBe(false);
    const answers = toAnswers(ask("a"), {
      checks: writeOther(many, pickOption(many, blankDraft, "test"), "  typecheck  "),
      db: chooseOther(one, writeOther(one, blankDraft, "draft only"), false),
    });
    expect(answers).toEqual([{ id: "checks", values: ["test"], otherText: "typecheck" }]);
    expect(toAnswers(ask("a"), { db: pickOption(one, blankDraft, "pg") })).toEqual([{ id: "db", values: ["pg"] }]);
  });
});
