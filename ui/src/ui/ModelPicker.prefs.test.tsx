// @vitest-environment happy-dom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModel } from "../contracts";
import type { ModelPrefs } from "../models/modelPrefs";
import { createModelPrefsSource, ModelPrefsContext, type ModelPrefsSource } from "../models/modelPrefsApi";
import { ModelPicker, type ModelBinding, type PickerOpen } from "./ModelPicker";

const opus: SessionModel = { provider: "proxy", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, scoped: true };
const flash: SessionModel = { provider: "proxy", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoning: true };
const old: SessionModel = { provider: "proxy", id: "claude-3-5-haiku-20241022", name: "Claude Haiku 3.5", reasoning: true };
const codex: SessionModel = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: false };

let root: Root;
let prefs: ModelPrefs;
let source: ModelPrefsSource;
let current: SessionModel;
let moves: string[];
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const rows = () => [...document.querySelectorAll(".model-row .model-row-name")].map((node) => node.firstChild?.textContent);
const labels = () => [...document.querySelectorAll(".model-group-label")].map((node) => node.textContent);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text);

function Fixture({ cycle }: { cycle: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<PickerOpen | undefined>();
  const [model, setModel] = useState(current);
  const binding: ModelBinding = {
    model, thinkingLevel: "high", disabled: false, cycle,
    listModels: async () => [opus, flash, old, codex], listThinkingLevels: async () => ["off", "high"],
    onModel: async (provider, id) => { moves.push(`${provider}/${id}`); setModel([opus, flash, old, codex].find((entry) => entry.provider === provider && entry.id === id)!); },
    onThinkingLevel: async (level) => { moves.push(`level:${level}`); },
  };
  return <div ref={anchor}><ModelPicker binding={binding} anchor={anchor} open={open} onOpenChange={setOpen} /></div>;
}
async function render(cycle = false) {
  await act(async () => root.render(<ModelPrefsContext.Provider value={source}><Fixture cycle={cycle} /></ModelPrefsContext.Provider>));
  await settle();
}
const ctrlP = (shiftKey = false) => act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: shiftKey ? "P" : "p", ctrlKey: true, shiftKey, bubbles: true, cancelable: true })); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  prefs = { revision: "r1", favorites: ["proxy/gemini-3.8-flash", "proxy/claude-opus-5-5:low"], visible: ["openai-codex/gpt-5.6-sol"], defaultModel: "proxy/claude-opus-5-5", defaultThinkingLevel: "high", favoritesPath: "/s", visiblePath: "/v", home: "/h" };
  source = createModelPrefsSource(async () => new Response(JSON.stringify(prefs), { status: 200, headers: { "content-type": "application/json" } }));
  current = opus;
  moves = [];
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("model menu with the app's lists", () => {
  it("shows favorites first and keeps hidden models one tap away", async () => {
    current = codex;
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>(".model-trigger")!.click());
    await settle();
    expect(labels()).toEqual(["Favorites", "Openai Codex"]);
    expect(rows()).toEqual(["Gemini 3.8 Flash", "Claude Opus 5.5", "GPT-5.6 Sol"]);
    await act(async () => button("Show 1 hidden model")!.click());
    expect(rows()).toEqual(["Gemini 3.8 Flash", "Claude Opus 5.5", "Claude Haiku 3.5", "GPT-5.6 Sol"]);
    expect(document.querySelector(".model-row[data-hidden]")?.textContent).toContain("hidden");
    await act(async () => button("Hide models you do not show")!.click());
    expect(rows()).toHaveLength(3);
  });

  it("follows a save made elsewhere while the menu is open", async () => {
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>(".model-trigger")!.click());
    await settle();
    prefs = { ...prefs, revision: "r2", favorites: [], visible: null };
    await act(async () => { await source.read(); });
    expect(labels()).toEqual(["Proxy", "Openai Codex"]);
  });
});

describe("Ctrl+P", () => {
  it("steps through favorites both ways, with a favorite's thinking level, and blocks the print command", async () => {
    await render(true);
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(event); });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    // From the second favorite (Opus), the next one wraps to the first.
    expect(moves).toEqual(["proxy/gemini-3.8-flash"]);
    await ctrlP(); await settle();
    expect(moves).toEqual(["proxy/gemini-3.8-flash", "proxy/claude-opus-5-5", "level:low"]);
    await ctrlP(true); await settle();
    expect(moves.at(-1)).toBe("proxy/gemini-3.8-flash");
    expect(document.querySelector("[role='status'].sr-only")?.textContent).toBe("Model: Gemini 3.8 Flash");
  });

  it("does nothing where the picker does not ask for it", async () => {
    await render(false);
    await ctrlP(); await settle();
    expect(moves).toEqual([]);
  });
});
