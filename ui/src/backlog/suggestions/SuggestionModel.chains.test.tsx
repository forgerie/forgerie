// @vitest-environment happy-dom
// Model chains in the background model's pickers: Change on the card, and Settings → Backlog's default.
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestionCard } from "./SuggestionCard";
import { cardInputs } from "./cardInputs";
import { createSuggestionsStore, type SuggestionsStore } from "./suggestionsStore";
import { memoryServer } from "./fixtures/memoryApi";
import { CHAT_MODEL, MODELS, NOW, OPEN, look } from "./fixtures/suggestions";
import { BacklogSettingsView } from "../BacklogSettings.binding";
import type { BacklogSettingsApi, BacklogSettingsCatalog } from "../backlogSettingsApi";
import { ModelPrefsContext } from "../../models/modelPrefsApi";
import { chainPrefsSource } from "../../models/fixtures/chainPrefs";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const chainRow = (name: string) => [...document.querySelectorAll<HTMLElement>(".floating-panel .option-row")].find((node) => node.textContent?.startsWith(name));
const click = async (node: HTMLElement | undefined) => { if (!node) throw new Error("Missing control"); await act(async () => node.click()); await settle(); };
const text = () => document.body.textContent ?? "";
const withChains = (node: React.ReactNode) => <ModelPrefsContext.Provider value={chainPrefsSource()}>{node}</ModelPrefsContext.Provider>;

function Card({ store }: { store: SuggestionsStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <SuggestionCard {...cardInputs({ reference: { suggestionId: OPEN.id }, view, store,
    links: { look, openSession: () => {}, openLink: () => {}, copy: async () => true }, chat: { model: CHAT_MODEL, thinkingLevel: "high" },
    knownModels: MODELS, listModels: async () => MODELS, now: NOW })} />;
}

describe("Change on the card", () => {
  it("picks a chain for this launch, says so, and File and act sends its name", async () => {
    const server = memoryServer([OPEN]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await act(async () => root.render(withChains(<Card store={store} />)));
    await act(async () => { await store.refresh(); });
    await settle();
    await click(document.querySelector<HTMLButtonElement>(".model-trigger[data-look=word]")!);
    expect(document.querySelector(".floating-panel .option-list-heading")?.textContent).toBe("Model chains");
    await click(chainRow("worker"));
    expect(text()).toContain("File and act starts a new session on the worker chain.");
    await click(button("File and act"));
    expect(server.presses).toEqual([{ id: OPEN.id, kind: "file-and-act", request: { modelSpec: "worker" } }]);
  });
});

describe("Settings → Backlog", () => {
  const catalog = (extra: Record<string, unknown> = {}): BacklogSettingsCatalog => ({
    settings: { sources: [], projects: [{ projectId: "p", source: "forgerie", revision: 2, backlog: { providers: ["markdown"] } as never }], ...extra },
    projects: [{ id: "p", name: "Project", path: "/repo" }],
  });
  const api = (value: BacklogSettingsCatalog, writes: unknown[]): BacklogSettingsApi => ({
    list: async () => value, githubLogin: async () => ({}), remove: async () => ({}),
    save: async (id, backlog, baseRevision) => { writes.push({ id, backlog, baseRevision }); return {}; },
    suggestionsDefault: async (model) => { writes.push({ suggestionsDefault: model }); return { saved: true }; },
    models: async () => MODELS, createSource: async () => ({}), saveSource: async () => ({}), removeSource: async () => ({}),
  });

  it("sets a chain as the global default and shows it on the trigger", async () => {
    const writes: unknown[] = [];
    await act(async () => root.render(withChains(<BacklogSettingsView api={api(catalog(), writes)} onOpen={() => {}} back={null} close={null} />)));
    await settle();
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    await click(chainRow("fast"));
    expect(writes).toEqual([{ suggestionsDefault: { modelSpec: "fast" } }]);
  });

  it("shows a saved chain on the trigger, and its level", async () => {
    await act(async () => root.render(withChains(<BacklogSettingsView api={api(catalog({ suggestionsDefault: { modelSpec: "worker", thinkingLevel: "low" } }), [])}
      onOpen={() => {}} back={null} close={null} />)));
    await settle();
    expect(document.querySelector(".model-trigger .model-trigger-choice")?.textContent).toBe("worker");
    expect(document.querySelector(".model-trigger .model-trigger-level")?.textContent).toBe("Low");
  });
});
