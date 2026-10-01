// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieDictationAdapter, type DictationDependencies } from "../speech/ForgerieDictationAdapter";
import { DictationProvider } from "../DictationProvider";
import type { PendingAsk } from "../contracts";
import { useThreadMessages } from "../useThreadMessages";
import { Composer } from "./Composer";

let root: Root;
let adapter: ForgerieDictationAdapter;
let dependencies: DictationDependencies;
const ask: PendingAsk = { askId: "ask", askedAt: "now", questions: [
  { id: "first", question: "Name?", options: [] }, { id: "second", question: "Port?", options: [] },
] };
function Fixture({ pending, offline = false }: { pending?: PendingAsk; offline?: boolean }) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew: async () => {}, adapters: { dictation: adapter }, isDisabled: offline });
  return <AssistantRuntimeProvider runtime={runtime}><DictationProvider adapter={adapter}>
    <Composer ask={pending && { ask: pending, phase: { type: "answering" }, offline, onSubmit: () => {}, onDismiss: () => {}, onChat: async () => {} }} />
  </DictationProvider></AssistantRuntimeProvider>;
}
const button = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const input = () => document.querySelector("textarea")!;
const render = (pending?: PendingAsk, offline = false) => act(async () => root.render(<Fixture pending={pending} offline={offline} />));
const click = (label: string) => act(async () => button(label).click());
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dependencies = {
    ready: async () => {}, capture: async () => ({ actualSampleRateHz: 16_000, failure: undefined,
      endpointWindow: () => new Float32Array(1_600), finalize: () => new Float32Array(1_600),
      synchronize: async () => {}, stopAndFinalize: async () => new Float32Array(1_600), abort: async () => {},
    }), transcribe: async () => ({ text: "spoken words" }),
  };
  adapter = new ForgerieDictationAdapter(dependencies);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("SDK dictation controls in the one composer", () => {
  it("appends final speech to the existing draft and never sends it automatically", async () => {
    await render(); await type("existing draft"); await click("Voice input");
    expect(input().disabled).toBe(true);
    expect(button("Send message").disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Listening…");
    await click("Stop dictation");
    expect(input().value).toBe("existing draft spoken words");
    expect(input().disabled).toBe(false);
    expect(button("Voice input")).not.toBeNull();
  });
  it("shows an error and restores typing after permission failure", async () => {
    dependencies.capture = async () => { throw new Error("Microphone permission was denied."); };
    await render(); await type("keep this"); await click("Voice input");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Microphone permission was denied.");
    expect(input().value).toBe("keep this"); expect(input().disabled).toBe(false);
  });
  it("cancels transcription on ask replacement without contaminating the restored chat draft", async () => {
    let resolve!: (result: { text: string }) => void;
    dependencies.transcribe = () => new Promise((yes) => { resolve = yes; });
    await render(); await type("chat draft"); await click("Voice input"); await click("Stop dictation");
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Transcribing…");
    await render(ask);
    expect(input().value).toBe(""); expect(input().disabled).toBe(false);
    await act(async () => resolve({ text: "stale text" }));
    expect(input().value).toBe("");
    await click("Voice input"); await click("Cancel dictation");
    expect(input().disabled).toBe(false);
    await render(); expect(input().value).toBe("chat draft");
  });
  it("supports dictation in ask mode, keeps one input, and blocks advancement during capture", async () => {
    await render(ask); await click("Voice input");
    const next = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === "Next")!;
    expect(next.disabled).toBe(true);
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    await click("Stop dictation"); expect(input().value).toBe("spoken words");
    await act(async () => next.click()); expect(input().value).toBe("");
    expect(document.querySelector(".ask-question")?.textContent).toBe("Port?");
  });
  it("preserves a long dictated answer but blocks sending beyond the server limit", async () => {
    dependencies.transcribe = async () => ({ text: "x".repeat(4001) });
    await render(ask); await click("Voice input"); await click("Stop dictation");
    expect(input().value).toHaveLength(4001);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("4000 characters");
    expect([...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === "Next")?.disabled).toBe(true);
    await type("short answer");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("cancels active capture when disconnected or unmounted", async () => {
    const abort = vi.fn(async () => {});
    const capture = await dependencies.capture({});
    dependencies.capture = async () => ({ ...capture, abort });
    await render(); await click("Voice input"); await render(undefined, true);
    expect(abort).toHaveBeenCalledOnce();
    await render(); await click("Voice input");
    await act(async () => root.unmount());
    expect(abort).toHaveBeenCalledTimes(2);
  });
});
