// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelPrefs, ModelPrefsSave } from "../../models/modelPrefs";
import { ModelPrefsContext, PrefsConflict, type ModelPrefsSource } from "../../models/modelPrefsApi";
import { ModelsView, startModel } from "./ModelsView";

const models = [
  { provider: "proxy", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true },
  { provider: "proxy", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoning: true },
  { provider: "proxy", id: "claude-3-5-haiku-20241022", name: "Claude Haiku 3.5", reasoning: true },
  { provider: "local", id: "llama3:8b", name: "Llama 3 8B", reasoning: false },
];
let root: Root;
let stored: ModelPrefs;
let saves: ModelPrefsSave[];
let refuse: boolean;
let source: ModelPrefsSource;
const listeners = new Set<(prefs: ModelPrefs) => void>();
const settle = () => act(async () => { for (let index = 0; index < 8; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
const group = (name: string) => [...document.querySelectorAll("section.agent-group")].find((node) => node.querySelector(".agent-group-label")?.textContent === name);
const names = (section: Element | undefined) => [...(section?.querySelectorAll(".model-pref-name") ?? [])].map((node) => node.textContent);

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  stored = { revision: "r0", favorites: ["proxy/claude-opus-5-5:high", "proxy/*"], visible: null, defaultModel: "proxy/claude-opus-5-5", defaultThinkingLevel: "xhigh", favoritesPath: "/home/me/agent/settings.json", visiblePath: "/home/me/.config/forgerie/visible-models.json", home: "/home/me" };
  saves = []; refuse = false; listeners.clear();
  source = {
    read: async () => { for (const listener of listeners) listener(stored); return stored; },
    save: async (save) => {
      saves.push(save);
      if (refuse) throw new PrefsConflict("The model lists changed since this page read them.");
      if (save.revision !== stored.revision) throw new Error("stale revision");
      stored = { ...stored, ...save, revision: `r${String(saves.length)}` };
      for (const listener of listeners) listener(stored);
      return stored;
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  await act(async () => root.render(<ModelPrefsContext.Provider value={source}>
    <ModelsView onBack={() => {}} listModels={async () => models} /></ModelPrefsContext.Provider>));
  await settle();
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("where a new session starts", () => {
  const lists = (defaultModel: string | null, favorites: string[] = []) => ({ favorites, visible: null, defaultModel });
  it("follows the server: the default, unless it is missing or outside the favorites", () => {
    expect(startModel(lists("local/llama3:8b"), models)).toMatchObject({ reason: "default", model: { id: "llama3:8b" } });
    expect(startModel(lists(null, ["proxy/gemini-3.8-flash"]), models)).toMatchObject({ reason: "unset", model: { id: "gemini-3.8-flash" } });
    expect(startModel(lists("gone/model"), models)).toMatchObject({ reason: "unavailable", model: { id: "claude-opus-5-5" } });
    expect(startModel(lists("local/llama3:8b", ["proxy/gemini-3.8-flash"]), models)).toMatchObject({ reason: "notFavorite", model: { id: "gemini-3.8-flash" } });
  });
});

describe("Models settings", () => {
  it("lists favorites, then each provider's models, and names the entries it leaves alone", () => {
    expect(names(group("Favorites"))).toEqual(["Claude Opus 5.5"]);
    expect(names(group("Proxy"))).toEqual(["Gemini 3.8 Flash", "Claude Haiku 3.5"]);
    expect(names(group("Local"))).toEqual(["Llama 3 8B"]);
    expect(document.body.textContent).toContain("Every model is shown.");
    expect(group("Favorites")?.textContent).toContain("proxy/*");
    expect(document.body.textContent).toContain("~/.config/forgerie/visible-models.json");
  });

  it("starts the allow-list at the first hide, then stars and saves each tap in order", async () => {
    await click(byLabel("Show Claude Haiku 3.5 in the model menu"));
    expect(saves[0]).toEqual({ revision: "r0", favorites: stored.favorites, visible: ["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash", "local/llama3:8b"] });
    expect(document.body.textContent).toContain("3 of 4 models shown.");
    await click(byLabel("Add Gemini 3.8 Flash to favorites"));
    expect(saves[1]).toMatchObject({ revision: "r1", favorites: ["proxy/claude-opus-5-5:high", "proxy/*", "proxy/gemini-3.8-flash"] });
    expect(names(group("Favorites"))).toEqual(["Claude Opus 5.5", "Gemini 3.8 Flash"]);
    expect(document.querySelector(".connection-status")?.textContent).toBe("Saved");
  });

  it("shows the default, locks it as a favorite, and changes it through the model menu", async () => {
    expect(document.querySelector(".models-default .model-trigger")?.textContent).toContain("Claude Opus 5.5");
    expect(document.querySelector(".models-default")?.textContent).toContain("starts at that level instead");
    expect(byLabel("Remove Claude Opus 5.5 from favorites").disabled).toBe(true);
    await click(document.querySelector<HTMLButtonElement>(".models-default .model-trigger")!);
    const row = [...document.querySelectorAll<HTMLButtonElement>(".model-panel .model-row")].find((node) => node.textContent?.includes("Llama 3 8B"))!;
    expect(document.querySelector(".model-panel .model-row[aria-current='true']")?.textContent).toContain("default");
    await click(row);
    expect(saves.at(-1)).toMatchObject({ defaultModel: "local/llama3:8b", favorites: ["proxy/claude-opus-5-5:high", "proxy/*", "local/llama3:8b"] });
    expect(saves.at(-1)?.defaultThinkingLevel).toBeUndefined();
    expect(names(group("Favorites"))).toEqual(["Claude Opus 5.5", "Llama 3 8B"]);
  });

  it("hides a whole provider, and brings every model back", async () => {
    await click([...group("Local")!.querySelectorAll("button")].find((node) => node.textContent === "Hide all")!);
    expect(saves.at(-1)?.visible).not.toContain("local/llama3:8b");
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Show every model")!);
    expect(saves.at(-1)?.visible).toContain("local/llama3:8b");
  });

  it("filters by search, and stops taking changes after a refused save until the lists are read again", async () => {
    const input = document.querySelector<HTMLInputElement>(".models-search input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "llama"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(names(group("Local"))).toEqual(["Llama 3 8B"]);
    expect(group("Proxy")).toBeUndefined();
    refuse = true;
    await click(byLabel("Add Llama 3 8B to favorites"));
    expect(document.querySelector("[role='alert']")?.textContent).toContain("changed since this page read them");
    expect(byLabel("Remove Llama 3 8B from favorites").disabled).toBe(true);
    refuse = false;
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Reload lists")!);
    expect(byLabel("Add Llama 3 8B to favorites").disabled).toBe(false);
  });
});
