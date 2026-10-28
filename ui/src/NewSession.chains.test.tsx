// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewSession, type LaunchDraft } from "./NewSession";
import { createDeferredFiles, type AgentChoice, type NewSessionApi } from "./newSession";
import { createDraftStore } from "./draftStore";
import { createLaunchStore } from "./launches";
import type { ComposerInputElement } from "./ui/ComposerEditor";
import { ModelPrefsContext } from "./models/modelPrefsApi";
import { chainPrefsSource } from "./models/fixtures/chainPrefs";
import { MODELS } from "./models/fixtures/chains";

let root: Root;
let starts: AgentChoice[];
const opus = MODELS[0]!;
const settle = () => act(async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const trigger = () => document.querySelector<HTMLButtonElement>(".ns-context .model-trigger")!;
const chainRow = (name: string) => [...document.querySelectorAll<HTMLElement>(".floating-panel .option-row")].find((node) => node.textContent?.startsWith(name));
const modelRow = (name: string) => [...document.querySelectorAll<HTMLElement>(".floating-panel .option-row")].find((node) => node.querySelector(".option-row-name")?.firstChild?.textContent === name);
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };

function api(defaultChain?: string): NewSessionApi {
  return {
    projects: async () => [{ id: "p1", name: "forgerie", path: "/code/forgerie" }],
    workspaces: async () => [],
    models: async () => ({ models: MODELS, model: opus, thinkingLevel: "high", ...(defaultChain ? { modelChain: defaultChain } : {}) }),
    promptResources: async () => [],
    start: async (cwd, _first, choice) => { starts.push(choice); return { type: "started", session: { id: "s-new", cwd } }; },
  };
}
async function render(defaultChain?: string) {
  const source = api(defaultChain);
  await act(async () => root.render(<ModelPrefsContext.Provider value={chainPrefsSource()}>
    <NewSession cwd="/code/forgerie" api={source} launches={createLaunchStore<LaunchDraft>(source)} deferred={createDeferredFiles()}
      drafts={createDraftStore(storage())} onStarted={() => {}} onClose={() => {}} />
  </ModelPrefsContext.Provider>));
  await settle();
}
async function send(text: string) {
  const input = document.querySelector<ComposerInputElement>(".ns-dialog [data-composer-input]")!;
  await act(async () => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ctrlKey: true })); });
  await settle();
}
const click = async (node: HTMLElement | undefined) => { await act(async () => node!.click()); await settle(); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  starts = [];
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("starts a session on the chain the author picked, with no model of its own", async () => {
  await render();
  await click(trigger());
  await click(chainRow("worker"));
  expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("worker");
  await send("Fix the build");
  expect(starts).toEqual([{ modelChain: "worker", thinkingLevel: "high" }]);
});

it("shows a default chain with the entry a session starts on, and a model choice leaves it", async () => {
  await render("fast");
  expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("fast");
  expect(trigger().querySelector(".model-trigger-name")?.textContent).toBe("Claude Opus 5.5");
  await click(trigger());
  await click(modelRow("GPT-5"));
  expect(trigger().querySelector(".model-trigger-choice")).toBeNull();
  await send("Fix the build");
  expect(starts).toEqual([{ model: MODELS[2], thinkingLevel: "high" }]);
});
