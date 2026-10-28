// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TriggerForm } from "./TriggerForm";
import { createOf, draftOf, type TriggerDraft } from "./triggerDraft";
import { HOST_ZONE, nightly } from "./fixtures/triggers";
import { draftScenario, folders, listModels, projectLabel, ZONES } from "./fixtures/scenario";
import { ModelPrefsContext } from "../models/modelPrefsApi";
import { chainPrefsSource } from "../models/fixtures/chainPrefs";

let root: Root;
let latest: TriggerDraft;
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const trigger = () => document.querySelector<HTMLButtonElement>(".model-trigger")!;
const chainRow = (name: string) => [...document.querySelectorAll<HTMLElement>(".floating-panel .option-row")].find((node) => node.textContent?.startsWith(name));

function Form({ start }: { start: TriggerDraft }) {
  const [draft, setDraft] = useState(start);
  latest = draft;
  const { workflows } = draftScenario(draft);
  return <TriggerForm draft={draft} onDraft={setDraft} problems={{}} disabled={false} hostZone={HOST_ZONE}
    timezones={ZONES} projectName={projectLabel} projects={folders} workflows={workflows} listModels={listModels} locale="en-US" />;
}
async function render(start: TriggerDraft) {
  await act(async () => root.render(<ModelPrefsContext.Provider value={chainPrefsSource()}><Form start={start} /></ModelPrefsContext.Provider>));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("runs a trigger on a model chain, sent by its name", async () => {
  await render({ ...draftOf(nightly), model: undefined, thinkingLevel: undefined });
  await act(async () => trigger().click());
  await settle();
  expect(document.querySelector(".floating-panel .option-list-heading")?.textContent).toBe("Model chains");
  await act(async () => chainRow("worker")!.click());
  await settle();
  expect(latest.model).toBe("worker");
  expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("worker");
  expect(createOf(latest, undefined).action).toMatchObject({ model: "worker" });
});

it("shows a saved chain, and Use the default clears it", async () => {
  await render({ ...draftOf(nightly), model: "fast", thinkingLevel: "low" });
  expect(trigger().querySelector(".model-trigger-choice")?.textContent).toBe("fast");
  expect(trigger().querySelector(".model-trigger-level")?.textContent).toBe("Low");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Use the default")!.click());
  expect(latest.model).toBeUndefined();
});
