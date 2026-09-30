// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskPhase } from "../ask";
import type { AskAnswer, PendingAsk } from "../contracts";
import { useThreadMessages } from "../useThreadMessages";
import { AskForm } from "./AskForm";
import { Thread } from "./Thread";

let root: Root;
const questions: PendingAsk = { askId: "a", askedAt: "2026-09-29T00:00:00Z", questions: [
  { id: "db", question: "Which database?", detail: "Both work with the ORM.", options: [
    { value: "pg", label: "Postgres", detail: "Matches production" }, { value: "lite", label: "SQLite" }] },
  { id: "checks", question: "Which checks run on save?", multiple: true, options: [
    { value: "lint", label: "Lint" }, { value: "test", label: "Tests" }] },
  { id: "name", question: "What should the service be called?", options: [] },
] };
const single: PendingAsk = { askId: "b", askedAt: "2026-09-29T00:00:00Z", questions: [questions.questions[0]!] };
interface Props { ask?: PendingAsk; phase?: AskPhase; offline?: boolean; onSubmit?: (answers: AskAnswer[]) => void; onDismiss?: () => void }
function Fixture({ ask, phase = { type: "answering" }, offline = false, onSubmit = () => {}, onDismiss = () => {} }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}>
    <main className="session-shell"><Thread ask={ask && <AskForm key={ask.askId} ask={ask} phase={phase} offline={offline}
      onSubmit={onSubmit} onDismiss={onDismiss} />} /></main>
  </AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text);
const byLabel = <T extends HTMLElement = HTMLButtonElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`);
const heading = () => document.querySelector(".ask-question")?.textContent;
function choose(label: string) {
  const input = [...document.querySelectorAll<HTMLLabelElement>(".ask-option")].find((node) => node.textContent?.startsWith(label))!.querySelector("input")!;
  return act(async () => input.click());
}
function type(field: HTMLTextAreaElement, text: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (button: HTMLElement | null | undefined) => act(async () => button!.click());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Ask form in place of the composer", () => {
  it("replaces the composer while an ask is open and restores the draft when it closes", async () => {
    await render();
    await type(byLabel<HTMLTextAreaElement>("Message")!, "half-written thought");
    await render({ ask: questions });
    expect(byLabel("Message")).toBeNull();
    expect(byLabel("Send message")).toBeNull();
    expect(byLabel("Questions from the agent")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Which database?");
    await render();
    expect(byLabel("Questions from the agent")).toBeNull();
    expect(byLabel<HTMLTextAreaElement>("Message")?.value).toBe("half-written thought");
  });

  it("steps through the questions, keeps answers across Back, and sends them in order", async () => {
    const onSubmit = vi.fn<(answers: AskAnswer[]) => void>();
    await render({ ask: questions, onSubmit });
    expect(document.querySelector(".ask-count")?.textContent).toBe("1 of 3");
    expect(document.querySelector(".ask-detail")?.textContent).toBe("Both work with the ORM.");
    await choose("Postgres");
    expect(byLabel("Question 1, answered")?.getAttribute("aria-current")).toBe("step");
    await click(byText("Next"));
    expect(heading()).toBe("Which checks run on save?");
    await choose("Lint"); await choose("Tests"); await choose("Lint");
    await type(byLabel<HTMLTextAreaElement>("Your own answer")!, "typecheck");
    expect(byLabel<HTMLInputElement>("Use your own answer")?.checked).toBe(true);
    await click(byLabel("Previous question"));
    expect(heading()).toBe("Which database?");
    expect(document.querySelector<HTMLInputElement>(".ask-option input:checked")?.parentElement?.textContent).toContain("Postgres");
    await click(byLabel("Question 3, not answered"));
    expect(byLabel("Use your own answer")).toBeNull();
    await type(byLabel<HTMLTextAreaElement>("Your answer")!, "  ledger  ");
    await click(byText("Send answers"));
    expect(onSubmit).toHaveBeenCalledWith([
      { id: "db", values: ["pg"] },
      { id: "checks", values: ["test"], otherText: "typecheck" },
      { id: "name", values: [], otherText: "ledger" },
    ]);
  });

  it("shows one question without a step rail and moves a typed answer out of the chosen option", async () => {
    const onSubmit = vi.fn<(answers: AskAnswer[]) => void>();
    await render({ ask: single, onSubmit });
    expect(document.querySelector(".ask-rail")).toBeNull();
    await choose("SQLite");
    await type(byLabel<HTMLTextAreaElement>("Your own answer")!, "DuckDB");
    expect(document.querySelectorAll(".ask-option input:checked")).toHaveLength(1);
    await click(byText("Send answer"));
    expect(onSubmit).toHaveBeenCalledWith([{ id: "db", values: [], otherText: "DuckDB" }]);
  });

  it("skips, reports a failed send beside the answers, and blocks sending while offline or busy", async () => {
    const onDismiss = vi.fn();
    await render({ ask: single, onDismiss, phase: { type: "answering", error: "Tree navigation is active" } });
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Tree navigation is active");
    await click(byText("Skip"));
    expect(onDismiss).toHaveBeenCalledOnce();
    await render({ ask: single, offline: true });
    expect(byText("Skip")?.disabled).toBe(true);
    expect(byText("Send answer")?.disabled).toBe(true);
    expect(byLabel<HTMLTextAreaElement>("Your own answer")?.disabled).toBe(false);
    await render({ ask: single, phase: { type: "sending", action: "submit" } });
    expect(byText("Sending…")?.disabled).toBe(true);
    expect(byLabel<HTMLTextAreaElement>("Your own answer")?.disabled).toBe(true);
  });

  it("starts a replacement ask blank and on its first question", async () => {
    await render({ ask: questions });
    await choose("Postgres");
    await click(byText("Next"));
    await render({ ask: { ...questions, askId: "newer" } });
    expect(heading()).toBe("Which database?");
    expect(document.querySelectorAll(".ask-option input:checked")).toHaveLength(0);
  });
});
