// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceLens, ResourceSettings } from "./ResourceLibrary.binding";
import { ResourceRequestError, type ResourceApi, type ResourceFile, type ResourceTarget } from "./resourceApi";
import { mobbinFile, sessionInventory, settingsInventory, testingGuideFile } from "./fixtures/resources";

let root: Root;
const saves: { target: ResourceTarget; id: string; text: string; base: string }[] = [];
let refuse: ResourceRequestError | undefined;
const files: Record<string, ResourceFile> = { [testingGuideFile.resource.id]: testingGuideFile, [mobbinFile.resource.id]: mobbinFile };
const api = {
  list: async (target: ResourceTarget) => target.kind === "settings" ? settingsInventory : sessionInventory,
  read: async (_target: ResourceTarget, id: string) => files[id]!,
  save: async (target: ResourceTarget, id: string, text: string, base: string) => {
    saves.push({ target, id, text, base });
    if (refuse) throw refuse;
    return { file: { ...files[id]!, text, revision: "f".repeat(64) }, effect: { kind: "uncommitted" as const } };
  },
} as unknown as ResourceApi;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-content")!)!;
const type = (text: string) => act(async () => { editor().dispatch({ changes: { from: editor().state.doc.length, insert: text } }); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  saves.length = 0; refuse = undefined;
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("lists a session's own files first and saves an edit against the revision it read", async () => {
  await act(async () => root.render(<ResourceLens api={api} sessionId="s1" cwd="/home/ada/code/acme/.worktree/sign-in" onClose={() => undefined} />));
  await flush();
  expect([...document.querySelectorAll("h2")].map((node) => node.textContent)).toEqual(["Skills and prompts", "This project", "Yours", "Built into Forgerie", "From packages"]);
  await act(async () => button("testing-guideRepository-specific testing guide.")?.click());
  await flush();
  expect(document.body.textContent).toContain("Saving leaves an uncommitted change in this checkout.");
  expect(button("Save")?.disabled).toBe(true);
  await type("One more rule.\n");
  expect(button("Save")?.disabled).toBe(false);
  await act(async () => button("Save")?.click());
  await flush();
  expect(saves).toEqual([{ target: { kind: "session", sessionId: "s1" }, id: testingGuideFile.resource.id, text: `${testingGuideFile.text}One more rule.\n`, base: testingGuideFile.revision }]);
  expect(document.body.textContent).toContain("Saved. The change is not committed.");
  expect(button("Save")?.disabled).toBe(true);
});

it("keeps the draft when the file changed on disk, and says how to recover", async () => {
  refuse = new ResourceRequestError("conflict", "This file changed on disk. Read it again before saving.", false);
  await act(async () => root.render(<ResourceSettings api={api} item={testingGuideFile.resource.id} onOpen={() => undefined} back={null} close={null} />));
  await flush();
  await type("Draft line.\n");
  await act(async () => button("Save")?.click());
  await flush();
  expect(document.body.textContent).toContain("This file changed on disk.");
  expect(document.body.textContent).toContain("Your edits are still here.");
  expect(editor().state.doc.toString()).toBe(`${testingGuideFile.text}Draft line.\n`);
  expect(button("Save")?.disabled).toBe(false);
});

it("shows a package file read-only, with the reason and no Save", async () => {
  await act(async () => root.render(<ResourceSettings api={api} item={mobbinFile.resource.id} onOpen={() => undefined} back={null} close={null} />));
  await flush();
  expect(document.body.textContent).toContain("A package update replaces this file");
  expect(button("Save")).toBeUndefined();
  expect(editor().state.readOnly).toBe(true);
});
