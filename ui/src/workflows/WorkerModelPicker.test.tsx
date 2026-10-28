// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPrefsContext } from "../models/modelPrefsApi";
import { chainPrefsSource } from "../models/fixtures/chainPrefs";
import { MODELS } from "../models/fixtures/chains";
import { WorkerModelPicker } from "./WorkerModelPicker";
import { modelName } from "./workflowRoute";

let root: Root;
let changes: (string | undefined)[];
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const trigger = () => document.querySelector<HTMLButtonElement>(".model-trigger")!;
const row = (name: string) => [...document.querySelectorAll<HTMLElement>(".option-row")].find((node) => node.querySelector(".option-row-name")?.firstChild?.textContent === name);
const levelButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".model-levels button")].find((node) => node.textContent === name);

function Picker({ start }: { start: string | undefined }) {
  const [model, setModel] = useState(start);
  return <WorkerModelPicker worker="api" model={model} models={{ known: MODELS, list: async () => MODELS }}
    onChange={(next) => { changes.push(next); setModel(next); }} />;
}
async function render(start: string | undefined) {
  await act(async () => root.render(<ModelPrefsContext.Provider value={chainPrefsSource()}><Picker start={start} /></ModelPrefsContext.Provider>));
  await settle();
}
const open = async () => { await act(async () => trigger().click()); await settle(); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  changes = [];
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("a worker's model chain", () => {
  it("chooses a chain and keeps the worker's level on it", async () => {
    await render("anthropic/claude-opus-5-5:high");
    await open();
    await act(async () => row("worker")!.click());
    await settle();
    expect(changes).toEqual(["worker:high"]);
    expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("worker");
    expect(trigger().querySelector(".model-trigger-level")?.textContent).toBe("High");
  });

  it("sets the chain's level, and a model choice leaves the chain with the same level", async () => {
    await render("fast");
    await open();
    await act(async () => levelButton("Low")!.click());
    await settle();
    expect(changes).toEqual(["fast:low"]);
    await act(async () => row("GPT-5")!.click());
    await settle();
    expect(changes).toEqual(["fast:low", "openai/gpt-5:low"]);
  });

  it("names a chain in the route's words", () => {
    expect(modelName("worker:high", MODELS)).toBe("the worker chain");
    expect(modelName("openai/gpt-5", MODELS)).toBe("GPT-5");
    expect(modelName(undefined)).toBe("its default model");
  });
});
