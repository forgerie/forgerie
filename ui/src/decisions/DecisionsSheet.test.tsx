// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionsSheet } from "./DecisionsSheet";
import { DecisionsOpener } from "./DecisionsOpener";
import { WorkflowRunSheet } from "../workflows/WorkflowRunSheet";
import { BUILDING, CHILD_LOOKS } from "../workflows/fixtures/runs";
import type { DecisionLogActions, DecisionLogView } from "./decisionsModel";
import { ANSWER, GUESS, LOG_NOW, OVERTURNED, RUN_DECISIONS, SESSION_ANSWER, SESSION_DECISIONS } from "./fixtures/decisions";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const sheet = () => document.querySelector("dialog")!;
const button = (name: string) => [...sheet().querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const records = () => [...sheet().querySelectorAll(".decision-record")];
const record = (question: string) => records().find((node) => node.textContent?.includes(question));
const footer = () => sheet().querySelector(".sheet-dialog-foot");
async function type(text: string) {
  const field = sheet().querySelector<HTMLTextAreaElement>(".sheet-dialog-foot textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The session's log as its store holds it, with overturn answered by `answer`. */
function Harness({ initial, answer, actions }: {
  initial: DecisionLogView;
  answer: (id: string, note: string) => { ok: true } | { ok: false; error: string };
  actions: { retry: () => void; overturn: (id: string, note: string) => void };
}) {
  const [log, setLog] = useState(initial);
  const logActions: DecisionLogActions = {
    onRetry: actions.retry,
    onDismissError: () => setLog((current) => ({ ...current, error: undefined })),
    onOverturn: async (id, note) => {
      actions.overturn(id, note);
      const result = answer(id, note);
      if (!result.ok) { setLog((current) => ({ ...current, error: result.error })); return false; }
      setLog((current) => ({ ...current, error: undefined, decisions: current.decisions?.map((decision) => decision.id === id
        ? { ...decision, state: { kind: "overturned", note, at: LOG_NOW } } : decision) }));
      return true;
    },
  };
  return <DecisionsSheet log={log} actions={logActions} now={() => LOG_NOW} onClose={() => {}} />;
}
async function open(initial: DecisionLogView, answer: (id: string, note: string) => { ok: true } | { ok: false; error: string } = () => ({ ok: true })) {
  const actions = { retry: vi.fn(), overturn: vi.fn() };
  await act(async () => root.render(<Harness initial={initial} answer={answer} actions={actions} />));
  return actions;
}

describe("the session's decisions sheet", () => {
  it("lists every decision newest first with who, when, the choice and the reason, and flags the guess", async () => {
    await open({ decisions: SESSION_DECISIONS });
    expect(sheet().querySelector(".sheet-dialog-subtitle")?.textContent).toBe("5 decisions, 1 flagged");
    expect(records().map((node) => node.querySelector(".decision-record-question")?.textContent)).toEqual(SESSION_DECISIONS.map((decision) => decision.question));
    const guess = record(GUESS.question)!;
    expect(guess.querySelector(".decision-record-head")?.textContent).toBe("parentguessed12m");
    expect(guess.querySelector(".decision-record-choice")?.textContent).toBe(GUESS.choice);
    expect(guess.querySelector(".decision-record-reason")?.textContent).toBe(GUESS.reason);
    expect(guess.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Flagged guess");
    expect(record(ANSWER.question)?.querySelector('[role="img"]')).toBeNull();
    // The section counts what still stands flagged.
    expect(sheet().querySelector(".list-section-aside [role='img']")?.getAttribute("aria-label")).toBe("1 flagged guess");
  });

  it("shows an overturned decision struck, with the reader's note, and offers no Overturn on it", async () => {
    await open({ decisions: SESSION_DECISIONS });
    const done = record(OVERTURNED.question)!;
    expect(done.querySelector("del.decision-record-choice")?.textContent).toBe(OVERTURNED.choice);
    expect(done.querySelector(".decision-record-status")?.textContent).toBe("Overturned");
    expect(done.querySelector(".decision-record-correction")?.textContent).toBe("you3mPut it in the header menu. The table foot is for paging.");
    expect(done.querySelector("button")).toBeNull();
  });

  it("says it is reading before the first answer, and says when the log is empty", async () => {
    await open({});
    expect(sheet().querySelector(".list-section-empty")?.textContent).toBe("Reading the decisions…");
    await act(async () => root.render(<DecisionsSheet log={{ decisions: [] }} actions={{ onRetry: () => {}, onDismissError: () => {} }} onClose={() => {}} />));
    expect(sheet().querySelector(".list-section-empty")?.textContent).toBe("No decisions yet.");
    expect(sheet().querySelector(".sheet-dialog-subtitle")?.textContent).toBe("None yet");
    expect(footer()).toBeNull();
  });

  it("says why a read failed, with Retry, and keeps what it read before", async () => {
    const actions = await open({ readError: "Durable storage is unavailable." });
    expect(sheet().querySelector(".alert-card")?.textContent).toContain("Durable storage is unavailable.");
    expect(records()).toHaveLength(0);
    await act(async () => { button("Retry")?.click(); });
    expect(actions.retry).toHaveBeenCalledOnce();
    await act(async () => root.render(<DecisionsSheet log={{ decisions: RUN_DECISIONS, readError: "HTTP 502" }} actions={{ onRetry: () => {}, onDismissError: () => {} }} onClose={() => {}} />));
    expect(sheet().querySelector(".alert-card")?.textContent).toContain("HTTP 502");
    expect(records()).toHaveLength(3);
  });

  it("overturns: Overturn opens the note field in the footer, Send overturns, and the row shows the note", async () => {
    const actions = await open({ decisions: SESSION_DECISIONS });
    expect(footer()).toBeNull();
    const overturn = record(GUESS.question)!.querySelector<HTMLButtonElement>("button")!;
    expect(overturn.textContent).toBe("Overturn");
    await act(async () => { overturn.click(); });
    expect(overturn.getAttribute("aria-pressed")).toBe("true");
    expect(footer()?.querySelector(".action-footer-note")?.textContent)
      .toBe("Overturn “Newest first, with the stage as a label on each row”. Your note goes to parent, or to its parent if parent has finished.");
    expect(button("Send and overturn")?.disabled).toBe(true);
    await type("Group by stage. Inside each stage, newest first.");
    await act(async () => { button("Send and overturn")?.click(); });
    expect(actions.overturn).toHaveBeenCalledWith(GUESS.id, "Group by stage. Inside each stage, newest first.");
    expect(footer()).toBeNull();
    const done = record(GUESS.question)!;
    expect(done.querySelector(".decision-record-status")?.textContent).toBe("Overturned");
    expect(done.querySelector(".decision-record-correction-text")?.textContent).toBe("Group by stage. Inside each stage, newest first.");
    expect(sheet().querySelector(".sheet-dialog-subtitle")?.textContent).toBe("5 decisions");
  });

  it("keeps the sheet open on a refused overturn: the reason in the footer, the note still in its field", async () => {
    await open({ decisions: SESSION_DECISIONS }, () => ({ ok: false, error: "The session's storage is unavailable." }));
    await act(async () => { record(ANSWER.question)!.querySelector("button")!.click(); });
    await type("Include them, with an archived column.");
    await act(async () => { button("Send and overturn")?.click(); });
    expect(sheet().open).toBe(true);
    expect(footer()?.querySelector('[role="alert"]')?.textContent).toBe("The session's storage is unavailable.");
    expect(footer()?.querySelector("textarea")?.value).toBe("Include them, with an archived column.");
    expect(record(ANSWER.question)?.querySelector(".decision-record-status")).toBeNull();
    // Cancel closes the field and the reason with it.
    await act(async () => { button("Cancel")?.click(); });
    expect(footer()).toBeNull();
  });

  it("moves the field to another decision and closes it when its own Overturn is pressed again", async () => {
    await open({ decisions: SESSION_DECISIONS });
    await act(async () => { record(GUESS.question)!.querySelector("button")!.click(); });
    await type("Draft for the guess");
    await act(async () => { record(SESSION_ANSWER.question)!.querySelector("button")!.click(); });
    expect(footer()?.querySelector(".action-footer-note")?.textContent).toContain(SESSION_ANSWER.choice);
    // A new decision starts with an empty note: a note is written for one choice.
    expect(footer()?.querySelector("textarea")?.value).toBe("");
    await act(async () => { record(SESSION_ANSWER.question)!.querySelector("button")!.click(); });
    expect(footer()).toBeNull();
  });

  it("is read only without an overturn action", async () => {
    await act(async () => root.render(<DecisionsSheet log={{ decisions: SESSION_DECISIONS }} actions={{ onRetry: () => {}, onDismissError: () => {} }} now={() => LOG_NOW} onClose={() => {}} />));
    expect(records().flatMap((node) => [...node.querySelectorAll("button")])).toEqual([]);
    expect(sheet().querySelector(".list-section-note")).toBeNull();
  });
});

describe("the run sheet's decisions", () => {
  it("lists only the run's decisions, under its route, with Overturn", async () => {
    const onOverturn = vi.fn(() => Promise.resolve(true));
    await act(async () => root.render(<WorkflowRunSheet run={BUILDING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} now={() => LOG_NOW}
      decisions={{ log: { decisions: SESSION_DECISIONS }, actions: { onRetry: () => {}, onDismissError: () => {}, onOverturn } }} />));
    expect(sheet().querySelector(".route-map")).not.toBeNull();
    expect(sheet().querySelector(".list-section-title")?.textContent).toBe("Decisions");
    expect(records().map((node) => node.querySelector(".decision-record-question")?.textContent)).toEqual(RUN_DECISIONS.map((decision) => decision.question));
    await act(async () => { record(GUESS.question)!.querySelector("button")!.click(); });
    await type("Group by stage.");
    await act(async () => { button("Send and overturn")?.click(); });
    expect(onOverturn).toHaveBeenCalledWith(GUESS.id, "Group by stage.");
  });

  it("says when the run has no decisions, and shows no list for a session without a log", async () => {
    await act(async () => root.render(<WorkflowRunSheet run={BUILDING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}}
      decisions={{ log: { decisions: [SESSION_ANSWER] }, actions: { onRetry: () => {}, onDismissError: () => {} } }} />));
    expect(sheet().querySelector(".list-section-empty")?.textContent).toBe("No decisions yet.");
    await act(async () => root.render(<WorkflowRunSheet run={BUILDING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />));
    expect(sheet().querySelector(".list-section")).toBeNull();
  });
});

describe("the header's way in", () => {
  it("counts flagged guesses quietly: no live colour, the count in its name", async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(<DecisionsOpener flagged={2} onOpen={onOpen} />));
    const opener = document.querySelector<HTMLButtonElement>(".badge-button")!;
    expect(opener.getAttribute("aria-label")).toBe("Decisions, 2 flagged guesses to look at");
    expect(opener.querySelector(".badge-button-count")?.textContent).toBe("2");
    expect(opener.hasAttribute("data-quiet")).toBe(true);
    expect(opener.hasAttribute("data-waiting")).toBe(false);
    await act(async () => { opener.click(); });
    expect(onOpen).toHaveBeenCalledOnce();
    await act(async () => root.render(<DecisionsOpener flagged={0} onOpen={onOpen} />));
    expect(document.querySelector(".badge-button-count")).toBeNull();
    expect(document.querySelector(".badge-button")?.getAttribute("aria-label")).toBe("Decisions");
  });
});
