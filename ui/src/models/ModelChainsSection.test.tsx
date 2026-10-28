// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelChains } from "@shared/modelChains";
import { ModelChainsSection } from "./ModelChainsSection";
import { AGENTS, CHAINS, FULL_CHAIN, MODELS, WHERE } from "./fixtures/chains";

let root: Root;
let saves: ModelChains[];
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
const entries = (chain: string) => [...document.querySelectorAll(`[aria-label="Models in ${chain}, first tried first"] > li`)]
  .map((row) => row.querySelector(".model-trigger")?.getAttribute("aria-label")?.replace(", change model and thinking level", ""));
const chainRow = (name: string) => [...document.querySelectorAll(".action-row")].find((row) => row.querySelector(".action-row-name")?.textContent === name);
const pick = async (name: string) => { await click([...document.querySelectorAll<HTMLButtonElement>(".floating-panel .option-row")].find((row) => row.textContent?.includes(name))!); };
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (form: HTMLFormElement) => { await act(async () => { form.requestSubmit(); }); await settle(); };

function Page({ start, problem = null, agents = AGENTS }: { start: ModelChains; problem?: string | null; agents?: typeof AGENTS | undefined }) {
  const [chains, setChains] = useState(start);
  return <ModelChainsSection chains={chains} problem={problem} models={MODELS} agents={agents} locked={false} generation={1} where={WHERE}
    onChange={(next) => { saves.push(next); setChains(next); }} />;
}
async function render(page: Parameters<typeof Page>[0]) {
  await act(async () => root.render(<Page {...page} />));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  saves = [];
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("Model chains", () => {
  it("shows each chain's models in order, with the help line, the agents that use it, and where it is saved", async () => {
    await render({ start: CHAINS });
    expect(entries("worker")).toEqual(["Claude Opus 5.5 High", "GPT-5", "GPT-5 mini Low"]);
    expect(document.body.textContent).toContain("tries its first model first, and moves down the list when a model is unavailable");
    expect(chainRow("worker")?.textContent).toContain("Used by Worker and Reviewer.");
    expect(chainRow("fast")?.textContent).toContain("No agent uses it yet.");
    expect(document.body.textContent).toContain(WHERE);
  });

  it("adds a model at the end through the model menu, and sets an entry's own level or clears it", async () => {
    await render({ start: CHAINS });
    await click(chainRow("fast")!.querySelector<HTMLButtonElement>(".model-trigger[data-look='word']")!);
    expect(document.querySelector(".floating-panel .model-thinking")).toBeNull();
    await pick("GPT-5 mini");
    expect(saves.at(-1)?.fast).toEqual(["anthropic/claude-haiku-4-5", "openai/gpt-5-mini"]);
    await click(byLabel("GPT-5 mini, change model and thinking level"));
    await click(button("High"));
    expect(saves.at(-1)?.fast).toEqual(["anthropic/claude-haiku-4-5", "openai/gpt-5-mini:high"]);
    expect(button("Agent's level").getAttribute("aria-pressed")).toBe("false");
    await click(button("Agent's level"));
    expect(saves.at(-1)?.fast).toEqual(["anthropic/claude-haiku-4-5", "openai/gpt-5-mini"]);
    // Every chain keeps its place in the file.
    expect(Object.keys(saves.at(-1)!)).toEqual(["worker", "fast"]);
  });

  it("reorders with the move buttons and the handle's arrow keys, and keeps focus on the moved row", async () => {
    await render({ start: CHAINS });
    expect(byLabel("Move Claude Opus 5.5 up").disabled).toBe(true);
    await click(byLabel("Move Claude Opus 5.5 down"));
    expect(saves.at(-1)?.worker).toEqual(["openai/gpt-5", "anthropic/claude-opus-5-5:high", "openai/gpt-5-mini:low"]);
    expect(document.activeElement).toBe(byLabel("Move Claude Opus 5.5 down"));
    expect(document.querySelector("[role='status']")?.textContent).toBe("Claude Opus 5.5, 2 of 3");
    const handle = byLabel("Drag to move GPT-5 mini");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    await settle();
    expect(saves.at(-1)?.worker).toEqual(["openai/gpt-5", "openai/gpt-5-mini:low", "anthropic/claude-opus-5-5:high"]);
    expect(document.activeElement).toBe(byLabel("Drag to move GPT-5 mini"));
    // At the bottom, Move down is off, so focus moves to Move up.
    await click(byLabel("Move GPT-5 mini down"));
    expect(document.activeElement).toBe(byLabel("Move GPT-5 mini up"));
  });

  it("removes an entry, but keeps a chain's last model", async () => {
    await render({ start: CHAINS });
    await click(byLabel("Remove GPT-5"));
    expect(saves.at(-1)?.worker).toEqual(["anthropic/claude-opus-5-5:high", "openai/gpt-5-mini:low"]);
    expect(byLabel("Remove Claude Haiku 4.5").disabled).toBe(true);
    expect(byLabel("Remove Claude Haiku 4.5").title).toBe("A chain keeps at least one model. Delete the chain instead.");
  });

  it("creates a chain only with a valid, unused name, and saves it with its first model", async () => {
    await render({ start: CHAINS });
    await click(button("New chain"));
    const form = document.querySelector<HTMLFormElement>("form")!;
    const input = form.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    await type(input, "Fast Lane");
    await submit(form);
    expect(form.querySelector("[role='alert']")?.textContent).toBe("Use lower-case letters, digits and hyphens, and start with a letter or digit.");
    await type(input, "fast");
    await submit(form);
    expect(form.querySelector("[role='alert']")?.textContent).toBe("There is already a chain named fast.");
    await type(input, "review");
    await submit(form);
    expect(saves).toEqual([]);
    expect(chainRow("review")?.textContent).toContain("Not saved yet");
    expect(chainRow("review")?.textContent).toContain("Add a model to save this chain.");
    // The model menu opens at once for the first model.
    await pick("GPT-5");
    expect(saves.at(-1)).toEqual({ ...CHAINS, review: ["openai/gpt-5"] });
    expect(chainRow("review")?.textContent).toContain("1 model");
  });

  it("deletes an unused chain after a second press, and warns before deleting one that agents name", async () => {
    await render({ start: CHAINS });
    await click(byLabel("More commands for fast"));
    await click(button("Delete chain"));
    expect(saves).toEqual([]);
    await click(button("Delete for good?"));
    expect(saves.at(-1)).toEqual({ worker: CHAINS.worker });
    await click(byLabel("More commands for worker"));
    await click(button("Delete chain"));
    expect(saves).toHaveLength(1);
    expect(chainRow("worker")?.textContent).toContain("Worker and Reviewer name this chain as their model. Until you choose another model for them, their runs will not start.");
    await click(button("Keep chain"));
    expect(chainRow("worker")?.textContent).not.toContain("name this chain");
    await click(byLabel("More commands for worker"));
    await click(button("Delete chain"));
    await click(button("Delete anyway"));
    expect(saves.at(-1)).toEqual({});
    expect(document.body.textContent).toContain("No chains yet.");
  });

  it("renames in place, keeping the chain's position, and asks first when agents name it", async () => {
    await render({ start: CHAINS });
    await click(byLabel("More commands for fast"));
    await click(button("Rename chain"));
    const form = () => chainRow("fast")!.querySelector<HTMLFormElement>("form")!;
    expect(form().querySelector("input")?.value).toBe("fast");
    await type(form().querySelector("input")!, "worker");
    await submit(form());
    expect(form().querySelector("[role='alert']")?.textContent).toBe("There is already a chain named worker.");
    await type(form().querySelector("input")!, "quick");
    await submit(form());
    expect(Object.keys(saves.at(-1)!)).toEqual(["worker", "quick"]);
    await click(byLabel("More commands for worker"));
    await click(button("Rename chain"));
    const renaming = chainRow("worker")!.querySelector<HTMLFormElement>("form")!;
    await type(renaming.querySelector("input")!, "builder");
    await submit(renaming);
    expect(saves).toHaveLength(1);
    expect(renaming.textContent).toContain("Worker and Reviewer name worker as their model");
    await click(button("Rename anyway"));
    expect(saves.at(-1)).toEqual({ builder: CHAINS.worker, quick: CHAINS.fast });
  });

  it("marks entries no provider offers, stops adding at the limit, and changes nothing while the file's chains are ignored", async () => {
    await render({ start: { full: FULL_CHAIN } });
    expect(chainRow("full")?.textContent).toContain("No signed-in provider offers this model, so runs skip it.");
    expect(chainRow("full")?.textContent).toContain("A chain holds at most 16 models.");
    expect(chainRow("full")!.querySelector<HTMLButtonElement>(".model-trigger[data-look='word']")!.disabled).toBe(true);
    act(() => root.unmount());
    const host = document.createElement("div"); document.body.replaceChildren(host); root = createRoot(host);
    await render({ start: { worker: ["anthropic/claude-opus-5-5", "missing-provider"] }, problem: 'Chain "worker": "missing-provider" is not a provider/model-id reference.' });
    expect(document.body.textContent).toContain("Forgerie ignores every chain until the file is fixed.");
    expect(chainRow("worker")?.textContent).toContain('"missing-provider" is not a provider/model-id reference.');
    expect(button("New chain").disabled).toBe(true);
    expect(byLabel("Remove Claude Opus 5.5").disabled).toBe(true);
  });

  it.each(["constructor"])("creates and fills a chain named %s, a key the map's prototype also has", async (name) => {
    await render({ start: CHAINS });
    await click(button("New chain"));
    const form = document.querySelector<HTMLFormElement>("form")!;
    await type(form.querySelector("input")!, name);
    await submit(form);
    expect(chainRow(name)?.textContent).toContain("Add a model to save this chain.");
    await pick("GPT-5 mini");
    expect(Object.hasOwn(saves.at(-1)!, name)).toBe(true);
    expect(saves.at(-1)?.[name]).toEqual(["openai/gpt-5-mini"]);
    expect(entries(name)).toEqual(["GPT-5 mini"]);
  });

  it.each(["__proto__", "toString"])("refuses %s as a name: the name rule allows no underscore or capital", async (name) => {
    await render({ start: CHAINS });
    await click(button("New chain"));
    const form = document.querySelector<HTMLFormElement>("form")!;
    await type(form.querySelector("input")!, name);
    await submit(form);
    expect(form.querySelector("[role='alert']")?.textContent).toBe("Use lower-case letters, digits and hyphens, and start with a letter or digit.");
    expect(saves).toEqual([]);
  });

  it("keeps focus in the entry that is left when a chain goes from two models to one", async () => {
    await render({ start: { worker: ["openai/gpt-5", "openai/gpt-5-mini"] } });
    await click(byLabel("Remove GPT-5"));
    expect(saves.at(-1)).toEqual({ worker: ["openai/gpt-5-mini"] });
    // The last row's own Remove and moves are off, so focus goes to a control of that row that is on, never the page.
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.closest("li")?.textContent).toContain("GPT-5 mini");
    expect(focused.disabled).toBe(false);
  });

  it("offers Move up, Move down and Remove in each row's menu too, for a narrow list", async () => {
    await render({ start: CHAINS });
    await click(byLabel("Move or remove GPT-5 mini"));
    await click([...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((node) => node.textContent === "Move up")!);
    expect(saves.at(-1)?.worker).toEqual(["anthropic/claude-opus-5-5:high", "openai/gpt-5-mini:low", "openai/gpt-5"]);
    await click(byLabel("Move or remove Claude Haiku 4.5"));
    const remove = [...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((node) => node.textContent === "Remove")!;
    expect(remove.disabled).toBe(true);
  });
});
