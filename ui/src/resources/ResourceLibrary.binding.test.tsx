// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ResourceLens, ResourceSettings } from "./ResourceLibrary.binding";
import { ResourceRequestError, type ResourceApi, type ResourceFile, type ResourceTarget } from "./resourceApi";
import type { Editor } from "@tiptap/core";
import { largeContextFile, mobbinFile, decompositionFile, sessionInventory, settingsInventory, testingGuideFile } from "./fixtures/resources";
import { markdownView } from "../markdown/markdownView";
import { loadMarkdownKit } from "../ui/markdownKit";

// The rich view loads Tiptap on first use; here it is ready before any file opens.
beforeAll(async () => { await loadMarkdownKit(); });

let root: Root;
const saves: { target: ResourceTarget; id: string; text: string; base: string }[] = [];
let refuse: ResourceRequestError | undefined;
const files: Record<string, ResourceFile> = Object.fromEntries([testingGuideFile, mobbinFile, decompositionFile, largeContextFile].map((file) => [file.resource.id, file]));
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
const rich = () => (document.querySelector('[role="textbox"]') as (HTMLElement & { editor: Editor }) | null)?.editor;
const typeRich = (text: string) => act(async () => { rich()!.commands.focus("end"); rich()!.commands.insertContent(text); });
const pressed = () => [...document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="View"] button')].find((node) => node.getAttribute("aria-pressed") === "true")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  saves.length = 0; refuse = undefined;
  // The CodeMirror cases below read the Source view; the rich cases at the end choose Rich themselves.
  markdownView.write("source");
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); localStorage.clear(); });

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

// Drafts outlive a page, so each rich case opens its file in a session of its own.
async function openGuide(sessionId: string) {
  await act(async () => root.render(<ResourceLens api={api} sessionId={sessionId} cwd="/home/ada/code/acme" onClose={() => undefined} />));
  await flush();
  await act(async () => button("testing-guideRepository-specific testing guide.")?.click());
  await flush();
}
const openInSettings = async (file: ResourceFile) => {
  await act(async () => root.render(<ResourceSettings api={api} item={file.resource.id} onOpen={() => undefined} back={null} close={null} />));
  await flush();
};
const richEditable = () => document.querySelector('[role="textbox"]')?.getAttribute("contenteditable") === "true";

it("opens Markdown formatted by default and never marks it edited for opening or switching", async () => {
  localStorage.clear();
  await openGuide("rich-1");
  expect(pressed()).toBe("Rich");
  expect(richEditable()).toBe(true);
  expect(document.querySelector('[role="textbox"] h1')?.textContent).toBe("Testing guide");
  await act(async () => button("Source")?.click());
  await act(async () => button("Rich")?.click());
  expect(button("Save")?.disabled).toBe(true);
});

it("keeps rich edits, unsaved, across a switch to Source, and remembers the view on this device", async () => {
  markdownView.write("rich");
  await openGuide("rich-2");
  await typeRich(" Then the suite.");
  const edited = testingGuideFile.text.replace("instead.\n", "instead. Then the suite.\n");
  expect(button("Save")?.disabled).toBe(false);
  await act(async () => button("Source")?.click());
  expect(markdownView.read()).toBe("source");
  expect(editor().state.doc.toString()).toBe(edited);
  expect(button("Save")?.disabled).toBe(false);
  await act(async () => button("Save")?.click());
  await flush();
  // The final newline survives the rich view.
  expect(saves.at(-1)?.text).toBe(edited);
});

it("shows a file the rich view would rewrite read-only, with a way to its source", async () => {
  markdownView.write("rich");
  await openInSettings(decompositionFile);
  expect(richEditable()).toBe(false);
  expect(document.body.textContent).toMatch(/Editing here would rewrite this file's Markdown in \d+ places\./);
  await act(async () => button("Edit source")?.click());
  expect(pressed()).toBe("Source");
  expect(editor().state.readOnly).toBe(false);
  // Edit source is for this file only: the device keeps Rich.
  expect(markdownView.read()).toBe("rich");
});

it("opens a file too large to format in Source, with Rich off and the reason shown", async () => {
  markdownView.write("rich");
  await openInSettings(largeContextFile);
  expect(pressed()).toBe("Source");
  expect(button("Rich")?.disabled).toBe(true);
  expect(document.body.textContent).toContain("Too large for the rich view.");
});

it("saves every edit typed since the last draw, not only the first", async () => {
  await act(async () => root.render(<ResourceLens api={api} sessionId="two-edits" cwd="/home/ada/code/acme" onClose={() => undefined} />));
  await flush();
  await act(async () => button("testing-guideRepository-specific testing guide.")?.click());
  await flush();
  await type("First rule.\n");
  await type("Second rule.\n");
  await act(async () => button("Save")?.click());
  await flush();
  expect(saves.at(-1)?.text).toBe(`${testingGuideFile.text}First rule.\nSecond rule.\n`);
});
