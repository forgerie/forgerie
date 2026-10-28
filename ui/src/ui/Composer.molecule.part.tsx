import { useEffect } from "react";
import type { SessionModel } from "../contracts";
import { Composer, type ComposerHandle } from "./Composer";
import type { ModelBinding } from "./ModelPicker";
import { FixtureRuntime } from "./fixtures/runtime";

export const name = "Composer";
export const note = "The one input bar. Its controls never squeeze: a measured plan moves the model picker, then Steer, Attach and Dictate into More, and the handle shortens to its total first; Send, Queue, Stop and the handle never move";

const MODELS: SessionModel[] = [
  { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
];
const model: ModelBinding = { model: MODELS[0], thinkingLevel: "high", disabled: false, listModels: async () => MODELS,
  listThinkingLevels: async () => ["off", "low", "medium", "high"], onModel: async () => undefined, onThinkingLevel: async () => undefined };
const handle: ComposerHandle = { counts: [{ count: 3, noun: "proposals" }, { count: 2, noun: "queued" }], folded: false, fresh: false,
  label: "Fold 3 proposals, 2 queued away", onToggle: () => undefined };
const working = { queue: true, steer: true };

/** Idle, with nothing at the input: no handle. */
export default function Idle() {
  return <FixtureRuntime><Composer model={model} /></FixtureRuntime>;
}
/** Idle, with the ledge's handle in words; on a narrow bar it shortens to its total, then the model moves into More. */
export function IdleHandle() {
  return <FixtureRuntime><Composer model={model} handle={handle} /></FixtureRuntime>;
}
/** The agent works and the draft can queue or steer: Steer moves into More after the model. */
export function Running() {
  return <FixtureRuntime running draft="Also check the session store"><Composer model={model} handle={handle} working={working} queued /></FixtureRuntime>;
}
/** Folded away, and a proposal arrived since: the handle's live dot. */
export function FoldedNew() {
  return <FixtureRuntime><Composer model={model} handle={{ ...handle, counts: [{ count: 4, noun: "proposals" }], folded: true, fresh: true,
    label: "Show 4 proposals, 1 new" }} /></FixtureRuntime>;
}
/** An agent's questions: Skip and Send answer are primary sends and never move. */
export function Ask() {
  return <FixtureRuntime><Composer model={model} handle={handle} ask={{ phase: { type: "answering" }, offline: false, onSubmit: () => undefined,
    onDismiss: () => undefined, onChat: async () => undefined, ask: { askId: "a1", askedAt: "2026-10-28T10:00:00Z", questions: [
      { id: "q1", question: "Which surface should the ledge use?", options: [{ value: "bar", label: "The bar's own surface" }, { value: "card", label: "A card of its own" }] },
    ] } }} /></FixtureRuntime>;
}
/** An extension asks for a line of text: Send answer never moves. */
export function Dialog() {
  return <FixtureRuntime><Composer model={model} handle={handle} dialog={{ count: 1, phase: { type: "answering" }, offline: false,
    onAnswer: () => undefined, onCancel: () => undefined,
    dialog: { dialogId: "d1", kind: "input", title: "Name the release branch", placeholder: "release/…", askedAt: "2026-10-28T10:00:00Z" } }} /></FixtureRuntime>;
}
/** A shell draft: Run command never moves. */
export function Shell() {
  return <FixtureRuntime draft="!npm test -- src/ui/composerOverflow.test.ts"><Composer model={model} handle={handle}
    shell={{ availability: { type: "ready" }, onRun: async () => undefined }} /></FixtureRuntime>;
}
/** More, opened, where the bar has moved controls into it: each row keeps what the control said, such as the model and its level. */
export function MoreOpen() {
  // Pressed as a reader would, once the bar has planned its row and drawn More, and only while it is closed.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const press = () => {
      const more = document.querySelector<HTMLButtonElement>("[data-slot='more']:not([data-overflow]) [aria-expanded='false']");
      if (more) more.click();
      else if (++tries < 60) frame = requestAnimationFrame(press);
    };
    frame = requestAnimationFrame(press);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <FixtureRuntime running draft="Also check the session store"><Composer model={model} handle={handle} working={working} queued /></FixtureRuntime>;
}
