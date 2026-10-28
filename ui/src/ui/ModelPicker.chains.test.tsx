// @vitest-environment happy-dom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModel } from "../contracts";
import { ModelPrefsContext, type ModelPrefsSource } from "../models/modelPrefsApi";
import { CHAINS, MODELS } from "../models/fixtures/chains";
import { chainPrefs, chainPrefsSource } from "../models/fixtures/chainPrefs";
import { ModelPicker, type ModelBinding, type PickerOpen } from "./ModelPicker";

const gpt5 = MODELS[2]!;
let root: Root;
let source: ModelPrefsSource;
let moves: string[];
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const trigger = () => document.querySelector<HTMLButtonElement>(".model-trigger")!;
const headings = () => [...document.querySelectorAll(".option-list-heading")].map((node) => node.textContent);
const row = (name: string) => [...document.querySelectorAll<HTMLElement>(".option-row")].find((node) => node.querySelector(".option-row-name")?.firstChild?.textContent === name);

/** A session's picker: a chain in effect runs on its active entry, and a model choice leaves the chain. */
function Session({ chain, model }: { chain: string | undefined; model: SessionModel | undefined }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<PickerOpen>();
  const [state, setState] = useState({ chain, model });
  const binding: ModelBinding = {
    model: state.model, thinkingLevel: "high", disabled: false,
    listModels: async () => MODELS, listThinkingLevels: async () => ["off", "high"],
    onModel: async (provider, id) => { moves.push(`${provider}/${id}`); setState({ chain: undefined, model: MODELS.find((item) => item.provider === provider && item.id === id) }); },
    onThinkingLevel: async (level) => { moves.push(`level:${level}`); },
    chain: { current: state.chain, onChoose: async (name) => { moves.push(`chain:${name}`); setState({ chain: name, model: undefined }); } },
  };
  return <div ref={anchor}><ModelPicker binding={binding} anchor={anchor} open={open} onOpenChange={setOpen} /></div>;
}
async function render(chain: string | undefined, model: SessionModel | undefined) {
  await act(async () => root.render(<ModelPrefsContext.Provider value={source}><Session chain={chain} model={model} /></ModelPrefsContext.Provider>));
  await settle();
}
async function openPanel() { await act(async () => trigger().click()); await settle(); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  source = chainPrefsSource();
  moves = [];
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("a session on a model chain", () => {
  it("names the chain and the entry it runs on now", async () => {
    await render("worker", gpt5);
    expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("worker");
    expect(trigger().querySelector(".model-trigger-name")?.textContent).toBe("GPT-5");
    expect(trigger().textContent).toContain("worker·GPT-5");
    expect(trigger().getAttribute("aria-label")).toBe("worker, now on GPT-5 High, change model and thinking level");
    expect(trigger().title).toBe("worker, now on GPT-5");
  });

  it("names the chain alone before it has an active entry", async () => {
    await render("fast", undefined);
    expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("fast");
    expect(trigger().querySelector(".model-trigger-sep")).toBeNull();
  });
});

describe("the chain group", () => {
  it("lists the chains above the models, each with its models in order", async () => {
    await render(undefined, gpt5);
    await openPanel();
    expect(headings()[0]).toBe("Model chains");
    expect(headings().length).toBeGreaterThan(1);
    expect(row("worker")?.textContent).toContain("Claude Opus 5.5 (High), then GPT-5, then GPT-5 mini (Low)");
    expect(row("fast")?.textContent).toContain("Claude Haiku 4.5");
    expect(row("GPT-5")?.getAttribute("aria-current")).toBe("true");
    expect(row("worker")?.getAttribute("aria-current")).toBeNull();
  });

  it("chooses a chain and closes", async () => {
    await render(undefined, gpt5);
    await openPanel();
    await act(async () => row("worker")!.click());
    await settle();
    expect(moves).toEqual(["chain:worker"]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("worker");
  });

  it("marks the chain in effect, not its active entry, so choosing that entry pins the model", async () => {
    await render("worker", gpt5);
    await openPanel();
    expect(row("worker")?.getAttribute("aria-current")).toBe("true");
    expect(row("GPT-5")?.getAttribute("aria-current")).toBeNull();
    await act(async () => row("GPT-5")!.click());
    await settle();
    expect(moves).toEqual(["openai/gpt-5"]);
    expect(trigger().querySelector(".model-trigger-choice")).toBeNull();
  });

  it("searches chains by name and by their models", async () => {
    await render(undefined, gpt5);
    await openPanel();
    const search = document.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "haiku"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    await settle();
    expect(row("fast")).toBeDefined();
    expect(row("worker")).toBeUndefined();
  });

  it("offers no chains while the daemon ignores them, and none when there are none", async () => {
    source = chainPrefsSource(chainPrefs(CHAINS, "modelChains must be an object."));
    await render(undefined, gpt5);
    await openPanel();
    expect(headings()).not.toContain("Model chains");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    source = chainPrefsSource(chainPrefs({}));
    await render(undefined, gpt5);
    await openPanel();
    expect(headings()).not.toContain("Model chains");
  });
});
