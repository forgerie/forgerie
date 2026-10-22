// @vitest-environment happy-dom
// The background model: Change on the card picks it for one launch, and Settings → Backlog sets the global default
// and a project's own, through the composer's model list.
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

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name || node.textContent?.includes(name));
const click = async (node: HTMLElement | undefined) => { if (!node) throw new Error("Missing control"); await act(async () => node.click()); await settle(); };
const panel = () => document.querySelector<HTMLElement>(".floating-panel");
const text = () => document.body.textContent ?? "";

function Card({ store }: { store: SuggestionsStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <SuggestionCard {...cardInputs({ reference: { suggestionId: OPEN.id }, view, store,
    links: { look, openSession: () => {}, openLink: () => {}, copy: async () => true }, chat: { model: CHAT_MODEL, thinkingLevel: "high" },
    knownModels: MODELS, listModels: async () => MODELS, now: NOW })} />;
}

describe("Change on the card", () => {
  it("picks the model for this launch only, and File and act sends it", async () => {
    const server = memoryServer([OPEN]);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    await act(async () => root.render(<Card store={store} />));
    await act(async () => { await store.refresh(); });
    await settle();
    await click(document.querySelector<HTMLButtonElement>(".model-trigger[data-look=word]")!);
    await click(button("Gemini 3.8 Flash", panel()!));
    expect(text()).toContain("File and act starts a new session on Gemini 3.8 Flash.");
    expect(button("Use the default")).toBeDefined();
    await click(button("File and act"));
    expect(server.presses).toEqual([{ id: OPEN.id, kind: "file-and-act", request: { modelSpec: "google/gemini-3-8-flash" } }]);
  });
});

describe("Settings → Backlog", () => {
  const catalog = (extra: Record<string, unknown> = {}): BacklogSettingsCatalog => ({
    settings: { sources: [], projects: [{ projectId: "p", source: "forgerie", revision: 2, backlog: { providers: ["markdown"], suggestions: { modelSpec: "google/gemini-3-8-flash" } } as never }], ...extra },
    projects: [{ id: "p", name: "Project", path: "/repo" }],
  });
  const api = (value: BacklogSettingsCatalog, writes: unknown[]): BacklogSettingsApi => ({
    list: async () => value, githubLogin: async () => ({}), remove: async () => ({}),
    save: async (id, backlog, baseRevision) => { writes.push({ id, backlog, baseRevision }); return {}; },
    suggestionsDefault: async (model) => { writes.push({ suggestionsDefault: model }); return { saved: true }; },
    models: async () => MODELS, createSource: async () => ({}), saveSource: async () => ({}), removeSource: async () => ({}),
  });

  it("sets the global default, says what an unset one means, and goes back to the chat's model", async () => {
    const writes: unknown[] = [];
    await act(async () => root.render(<BacklogSettingsView api={api(catalog(), writes)} onOpen={() => {}} back={null} close={null} />));
    await settle();
    expect(text()).toContain("With neither set, the session uses the model of the chat the suggestion came from.");
    expect(document.querySelector(".model-trigger")?.textContent).toContain("The chat's model");
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    await click(button("Claude Haiku 4.5", panel()!));
    expect(writes).toEqual([{ suggestionsDefault: { modelSpec: "anthropic/claude-haiku-4-5" } }]);
  });

  it("offers Use the chat's model when a default is set", async () => {
    const writes: unknown[] = [];
    await act(async () => root.render(<BacklogSettingsView api={api(catalog({ suggestionsDefault: { modelSpec: "anthropic/claude-haiku-4-5" } }), writes)}
      onOpen={() => {}} back={null} close={null} />));
    await settle();
    expect(document.querySelector(".model-trigger")?.textContent).toContain("Claude Haiku 4.5");
    await click(button("Use the chat's model"));
    expect(writes).toEqual([{ suggestionsDefault: null }]);
  });

  it("keeps a project's own model when its other settings are saved, and can drop it", async () => {
    const writes: unknown[] = [];
    await act(async () => root.render(<BacklogSettingsView selected="p" api={api(catalog({ suggestionsDefault: { modelSpec: "anthropic/claude-haiku-4-5" } }), writes)}
      onOpen={() => {}} back={null} close={null} />));
    await settle();
    expect(text()).toContain("Unset: the global default, Claude Haiku 4.5.");
    expect(document.querySelector(".model-trigger")?.textContent).toContain("Gemini 3.8 Flash");
    await click(button("Save changes"));
    expect(writes.at(-1)).toEqual({ id: "p", backlog: { providers: ["markdown"], suggestions: { modelSpec: "google/gemini-3-8-flash" } }, baseRevision: 2 });
    await click(button("Use the global default"));
    await click(button("Save changes"));
    expect(writes.at(-1)).toEqual({ id: "p", backlog: { providers: ["markdown"] }, baseRevision: 2 });
  });
});
