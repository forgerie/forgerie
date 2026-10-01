import { describe, expect, it } from "vitest";
import { noAsk, reduceAskEvent, resyncAsk, whileOpen, type AskState } from "./ask";
import { blankDraft, isAnswered, pickOption, routeOf, settle, toAnswers } from "./askDraft";
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
  it("lets one choice replace typed text, and typed text replace one choice", () => {
    const typed = { values: [], text: "MySQL" };
    expect(pickOption(one, typed, "pg")).toEqual({ values: ["pg"], text: "" });
    expect(settle(one, { values: ["pg"], text: "DuckDB" })).toEqual({ values: [], text: "DuckDB" });
    expect(settle(one, { values: ["pg"], text: "  " })).toEqual({ values: ["pg"], text: "  " });
  });
  it("toggles several choices and keeps typed text beside them", () => {
    let draft = pickOption(many, { values: [], text: "typecheck" }, "lint");
    draft = pickOption(many, draft, "test");
    draft = pickOption(many, draft, "lint");
    expect(draft).toEqual({ values: ["test"], text: "typecheck" });
    expect(settle(many, draft)).toBe(draft);
  });
  it("counts blank text as unanswered and sends settled answers in question order", () => {
    expect(isAnswered(one, { values: [], text: "   " })).toBe(false);
    expect(toAnswers(ask("a"), {
      checks: { values: ["test"], text: "  typecheck  " },
      db: { values: ["pg"], text: "DuckDB" },
    })).toEqual([{ id: "db", values: [], otherText: "DuckDB" }, { id: "checks", values: ["test"], otherText: "typecheck" }]);
    expect(toAnswers(ask("a"), { db: pickOption(one, blankDraft, "pg") })).toEqual([{ id: "db", values: ["pg"] }]);
  });
  it("routes slash and shell commands to chat and everything else to the form", () => {
    expect(routeOf("  /review")).toBe("chat");
    expect(routeOf("!ls src")).toBe("chat");
    expect(routeOf("!! git log")).toBe("chat");
    expect(routeOf("use /tmp for it")).toBe("answer");
    expect(routeOf("!")).toBe("answer");
    expect(routeOf("!@src/app.ts")).toBe("answer");
    expect(routeOf("")).toBe("answer");
  });
});
