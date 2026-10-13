// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildEntryView } from "./ChildEntryView";
import { CHILD_QUESTION_TYPE, childEntryOf, foldChildEntries, type ChildEntry } from "./childAgentsModel";
import { waitingItems } from "../waitingOnYou";
import type { PiMessage } from "../contracts";

const question = (details: Record<string, unknown>): PiMessage => ({ role: "custom", customType: CHILD_QUESTION_TYPE, content: "",
  details: { questionId: "q:41", child: 22, childName: "build", question: "Force-push feat/run-export-api?", ...details } });
const ESCALATION = { kind: "irreversible", guess: "Yes, with --force-with-lease.", why: "Because only this worker has pushed to the branch." };

describe("a question the parent passed on", () => {
  it("carries the parent's guess and why, and still reads without them", () => {
    expect(childEntryOf(question({ escalation: ESCALATION }))).toMatchObject({ kind: "question", escalation: ESCALATION });
    expect(childEntryOf(question({}))).not.toHaveProperty("escalation");
    // A malformed escalation drops out; the question stays answerable.
    const bad = childEntryOf(question({ escalation: { kind: "later", guess: "Yes" } }));
    expect(bad).toMatchObject({ kind: "question", question: "Force-push feat/run-export-api?" });
    expect(bad).not.toHaveProperty("escalation");
  });

  it("waits on the reader in the dock, and keeps the escalation once answered", () => {
    const entry = childEntryOf(question({ escalation: ESCALATION }));
    const messages = [{ id: "m1", childEntry: entry }];
    expect(waitingItems(messages, [])).toHaveLength(1);
    const answered = foldChildEntries([...messages, { id: "m2", childEntry: { kind: "answer", questionId: "q:41", answer: "Yes." } satisfies ChildEntry }]);
    expect(answered[0]?.childEntry).toMatchObject({ answer: "Yes.", escalation: ESCALATION });
    expect(waitingItems(answered, [])).toEqual([]);
  });
});

describe("the question card", () => {
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

  it("says what the parent would choose, because why, and why it asks", async () => {
    const entry = childEntryOf(question({ escalation: ESCALATION }))!;
    await act(async () => root.render(<ChildEntryView entry={entry} onAnswer={() => Promise.resolve()} />));
    expect([...document.querySelectorAll(".question-card-context p")].map((node) => node.textContent)).toEqual([
      "The parent would choose: Yes, with --force-with-lease, because only this worker has pushed to the branch.",
      "It cannot be undone, so the parent asks you.",
    ]);
    expect(document.querySelector(".question-card-context strong")?.textContent).toBe("Yes, with --force-with-lease");
  });

  it("names an action outside the project, and hides the guess once the question is answered", async () => {
    const entry = childEntryOf(question({ escalation: { kind: "external", guess: "", why: "" } }));
    if (entry?.kind !== "question") throw new Error("Not a question");
    await act(async () => root.render(<ChildEntryView entry={entry} onAnswer={() => Promise.resolve()} />));
    expect(document.querySelector(".question-card-context")?.textContent).toBe("It acts outside the project in your name, so the parent asks you.");
    await act(async () => root.render(<ChildEntryView entry={{ ...entry, answer: "No." }} />));
    expect(document.querySelector(".question-card-context")).toBeNull();
    expect(document.querySelector(".question-card-answer")?.textContent).toBe("No.");
  });

  it("draws a plain question as before", async () => {
    await act(async () => root.render(<ChildEntryView entry={childEntryOf(question({}))!} onAnswer={() => Promise.resolve()} />));
    expect(document.querySelector(".question-card-context")).toBeNull();
  });
});
