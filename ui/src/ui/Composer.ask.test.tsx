// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskPhase } from "../ask";
import type { AskAnswer, PendingAsk } from "../contracts";
import type { CommandCatalog } from "../commands";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";
import type { ComposerInputElement } from "./ComposerEditor";

let root: Root;
const questions: PendingAsk = { askId: "a", askedAt: "2026-09-29T00:00:00Z", questions: [
  { id: "db", question: "Which database?", detail: "Both work with the ORM.", options: [
    { value: "pg", label: "Postgres", detail: "Matches production" }, { value: "lite", label: "SQLite" }] },
  { id: "checks", question: "Which checks run on save?", multiple: true, options: [
    { value: "lint", label: "Lint" }, { value: "test", label: "Tests" }] },
  { id: "name", question: "What should the service be called?", options: [] },
] };
const single: PendingAsk = { askId: "b", askedAt: "2026-09-29T00:00:00Z", questions: [questions.questions[0]!] };
interface Props {
  ask?: PendingAsk; phase?: AskPhase; offline?: boolean;
  onSubmit?: (answers: AskAnswer[]) => void; onDismiss?: () => void; onChat?: (text: string) => Promise<void>;
  onNew?: (message: AppendMessage) => Promise<void>;
  commands?: CommandCatalog; onRetry?: () => void;
}
function Fixture({ ask, phase = { type: "answering" }, offline = false, onSubmit = () => {}, onDismiss = () => {},
  onChat = async () => {}, onNew = async () => {}, commands, onRetry = () => {} }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew, isDisabled: offline });
  return <AssistantRuntimeProvider runtime={runtime}>
    <main className="session-shell"><Thread ask={ask && { ask, phase, offline, onSubmit, onDismiss, onChat }} commands={commands && { catalog: commands, onRetry }} /></main>
  </AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text);
const byLabel = <T extends HTMLElement = HTMLButtonElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`);
const input = () => byLabel<ComposerInputElement>("Message")!;
const heading = () => document.querySelector(".ask-question")?.textContent;
const checked = () => [...document.querySelectorAll<HTMLInputElement>(".ask-option input:checked")].map((node) => node.parentElement?.textContent);
function choose(label: string) {
  const option = [...document.querySelectorAll<HTMLLabelElement>(".ask-option")].find((node) => node.textContent?.startsWith(label))!;
  return act(async () => option.querySelector("input")!.click());
}
function type(text: string) {
  return act(async () => {
    input().value = text;
    input().setSelectionRange(text.length, text.length);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (init: KeyboardEventInit) => act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
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

const commandList: CommandCatalog = { type: "ready", commands: [
  { name: "name", source: "builtin", description: "Set session name" },
  { name: "review", source: "prompt", description: "Review changes" },
  { name: "skill:test", source: "skill", description: "Write tests" },
] };

describe("assistant-ui slash palette", () => {
  it("filters and completes plain Pi text with keyboard, then sends only after confirmation", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ commands: commandList, onNew });
    await type("/re");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('[role="option"]')?.textContent).toBe("/reviewReview changes");
    await press({ key: "Enter" });
    expect(onNew).not.toHaveBeenCalled();
    expect(input().value).toBe("/review ");
    await type("/review src/sessionStore.ts");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await press({ key: "Enter" });
    expect(onNew.mock.calls[0]?.[0].content).toEqual([{ type: "text", text: "/review src/sessionStore.ts" }]);
  });
  it("completes on touch and Escape dismisses without losing text", async () => {
    await render({ commands: commandList });
    await type("/");
    await click(document.querySelector<HTMLElement>('[role="option"]'));
    expect(input().value).toBe("/name ");
    await type("/sk");
    await press({ key: "Escape" });
    expect(input().value).toBe("/sk");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await type("/skill:");
    expect(document.querySelector('[role="option"]')?.textContent).toContain("/skill:test");
  });
  it("shows a command's line and a skill's name alone, so no row carries a paragraph", async () => {
    await render({ commands: commandList });
    await type("/");
    expect([...document.querySelectorAll('[role="option"]')].map((row) => row.textContent))
      .toEqual(["/nameSet session name", "/reviewReview changes", "/skill:test"]);
  });
  it("gives the palette Enter precedence over ask submission and keeps the single input", async () => {
    const onSubmit = vi.fn();
    const onChat = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    await render({ ask: single, commands: commandList, onSubmit, onChat });
    await type("/na");
    await press({ key: "Enter" });
    expect(input().value).toBe("/name ");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChat).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-composer-input]")).toHaveLength(1);
    await type("/name New name");
    await press({ key: "Enter" });
    expect(onChat).toHaveBeenCalledWith("/name New name");
  });
  it("shows discovery failure and retries, and reports no matches", async () => {
    const onRetry = vi.fn();
    await render({ commands: { type: "failed", message: "offline catalog" }, onRetry });
    await type("/");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("offline catalog");
    await click(byText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
    await render({ commands: commandList });
    await type("/missing");
    expect(document.querySelector(".command-hint")?.textContent).toContain("No matching commands");
  });
});

describe("Composer in ask mode", () => {
  it("keeps one input, sets the draft aside while the ask is open, and puts it back after", async () => {
    await render();
    const element = input();
    await type("half-written thought");
    await render({ ask: questions });
    expect(document.querySelectorAll(".composer [data-composer-input]")).toHaveLength(1);
    expect(input()).toBe(element);
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("Or answer in your own words");
    expect(input().getAttribute("aria-describedby")).toBe(document.querySelector(".ask-question")?.id);
    expect(byLabel("Send message")).toBeNull();
    expect(document.querySelector(".composer .ask")?.getAttribute("aria-label")).toBe("Questions from the agent");
    await type("answer in progress");
    await render();
    expect(document.querySelector(".ask")).toBeNull();
    expect(input()).toBe(element);
    expect(input().value).toBe("half-written thought");
    expect(byLabel("Send message")).not.toBeNull();
  });

  it("answers each question through the input and options, and keeps answers across Back", async () => {
    const onSubmit = vi.fn<(answers: AskAnswer[]) => void>();
    await render({ ask: questions, onSubmit });
    expect(document.querySelector(".ask-count")?.textContent).toBe("1 of 3");
    await choose("Postgres");
    expect(byLabel("Question 1, answered")?.getAttribute("aria-current")).toBe("step");
    await press({ key: "Enter" });
    expect(heading()).toBe("Which checks run on save?");
    await choose("Lint"); await choose("Tests"); await choose("Lint");
    await type("typecheck");
    await click(byLabel("Previous question"));
    expect(heading()).toBe("Which database?");
    expect(checked()).toEqual(["PostgresMatches production"]);
    expect(input().value).toBe("");
    await click(byLabel("Question 2, answered"));
    expect(input().value).toBe("typecheck");
    expect(checked()).toEqual(["Tests"]);
    await click(byLabel("Question 3, not answered"));
    expect(document.querySelector(".ask-options")).toBeNull();
    expect(input().placeholder).toBe("Type your answer");
    await type("  ledger  ");
    await press({ key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await click(byText("Send answers"));
    expect(onSubmit).toHaveBeenCalledWith([
      { id: "db", values: ["pg"] },
      { id: "checks", values: ["test"], otherText: "typecheck" },
      { id: "name", values: [], otherText: "ledger" },
    ]);
  });

  it("lets one choice and typed text replace each other in a one-choice question", async () => {
    const onSubmit = vi.fn<(answers: AskAnswer[]) => void>();
    await render({ ask: single, onSubmit });
    expect(document.querySelector(".ask-rail")).toBeNull();
    await type("DuckDB");
    await choose("SQLite");
    expect(input().value).toBe("");
    await type("DuckDB");
    expect(checked()).toEqual([]);
    await press({ key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith([{ id: "db", values: [], otherText: "DuckDB" }]);
  });

  it("sends a slash command as a chat message and restores it if the send fails", async () => {
    const onChat = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const onSubmit = vi.fn();
    await render({ ask: single, onChat, onSubmit });
    await type("/review");
    expect(document.querySelector(".ask-route")?.textContent).toContain("Questions stay open unless Pi closes them");
    expect(document.querySelector(".ask")?.hasAttribute("data-folded")).toBe(true);
    expect(byText("Skip")).toBeUndefined();
    await press({ key: "Enter" });
    expect(onChat).toHaveBeenCalledWith("/review");
    expect(input().value).toBe("/review");
    await click(byText("Send message"));
    expect(onChat).toHaveBeenCalledTimes(2);
    expect(input().value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("skips, reports a failed send, and blocks sending while offline or busy", async () => {
    const onDismiss = vi.fn();
    await render({ ask: single, onDismiss, phase: { type: "answering", error: "Tree navigation is active" } });
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Tree navigation is active");
    await click(byText("Skip"));
    expect(onDismiss).toHaveBeenCalledOnce();
    await render({ ask: single, offline: true });
    expect(byText("Skip")?.disabled).toBe(true);
    expect(byText("Send answer")?.disabled).toBe(true);
    await render({ ask: single, phase: { type: "sending", action: "submit" } });
    expect(byText("Sending…")?.disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>(".ask-option input")?.disabled).toBe(true);
  });

  it("starts a replacement ask blank and on its first question", async () => {
    await render({ ask: questions });
    await choose("Postgres");
    await press({ key: "Enter" });
    await type("lint only");
    await render({ ask: { ...questions, askId: "newer" } });
    expect(heading()).toBe("Which database?");
    expect(checked()).toEqual([]);
    expect(input().value).toBe("");
  });
});
