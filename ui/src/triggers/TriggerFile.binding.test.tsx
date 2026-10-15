// @vitest-environment happy-dom
// The trigger page as the page of the workflow file that holds the trigger: the real binding and page, with the
// in-memory store in the HTTP client's place.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trigger } from "@shared/triggers";
import type { TriggerFileSaveRequest } from "@shared/triggerFiles";
import { TriggersScreen } from "./Triggers.binding";
import { useTriggerList } from "./useTriggerList";
import type { TriggerPlace } from "./triggersModel";
import { HOST_ZONE, NOW } from "./fixtures/triggers";
import {
  brokenDocument, brokenMaintenance, maintenance, maintenanceDocument, maintenanceVersions, MAINTENANCE_PATH, MAINTENANCE_TEXT, unscheduledDocument, unscheduledMaintenance,
} from "./fixtures/triggerFiles";
import { memoryApi, memoryDirectory, type MemoryFile, type MemoryStore } from "./fixtures/memoryApi";
import { createTriggerMemory, type TriggerMemory } from "./triggerMemory";
import type { FileTrigger } from "./triggersApi";
import { markdownView } from "../ui/markdownView";
import { loadMarkdownKit } from "../ui/markdownKit";

beforeAll(async () => { await loadMarkdownKit(); });

let root: Root;
let store: MemoryStore;
let place: TriggerPlace = { view: "trigger", id: maintenance.id };
const moves: (TriggerPlace | undefined)[] = [];
let memory: TriggerMemory;

function Harness() {
  const list = useTriggerList(store.api);
  return <TriggersScreen list={list} api={store.api} directory={memoryDirectory} memory={memory} now={() => NOW} zone={HOST_ZONE} locale="en-US"
    args={{ place, onPlace: (next) => { moves.push(next); if (next) place = next; }, onOpenSession: () => undefined, sessionName: () => undefined }} />;
}
const flush = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const open = async (trigger: Trigger = maintenance, file: MemoryFile = { document: maintenanceDocument, versions: maintenanceVersions }) => {
  place = { view: "trigger", id: trigger.id };
  store = memoryApi([trigger], { now: NOW, files: { [trigger.id]: file } });
  await act(async () => root.render(<Harness />));
  await flush();
};
const text = () => document.body.textContent ?? "";
const button = (name: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => { const label = node.getAttribute("aria-label") ?? node.textContent ?? ""; return typeof name === "string" ? label === name || node.textContent === name : name.test(label); });
const press = async (name: string | RegExp) => {
  const target = button(name);
  if (!target) throw new Error(`No button ${String(name)} in: ${text().slice(0, 400)}`);
  await act(async () => { target.click(); });
  await flush();
};
const code = () => EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-content")!)!;
const typeCode = (insert: string) => act(async () => { code().dispatch({ changes: { from: code().state.doc.length, insert } }); });
const rich = () => (document.querySelector('[role="textbox"]') as (HTMLElement & { editor: Editor }) | null)?.editor;
const setTime = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Time"]');
  if (!input) throw new Error("No time field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};
const saves = () => store.calls.filter((call) => call[0] === "saveFile").map((call) => call[2] as TriggerFileSaveRequest);
const unsaved = () => document.querySelector('[aria-label="Unsaved changes"]') !== null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  memory = createTriggerMemory();
  moves.length = 0;
  markdownView.write("rich");
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("a trigger whose settings live in a workflow file", () => {
  it("opens as the file's page: title, description, status, the path, the prose in Rich, and the panel", async () => {
    await open();
    expect(store.calls).toContainEqual(["file", maintenance.id]);
    expect(store.calls).toContainEqual(["versions", maintenance.id]);
    expect(document.querySelector("h2")?.textContent).toBe("Nightly maintenance");
    expect(text()).toContain("Fix failing tests, keep checks fast, and simplify code overnight");
    expect(text()).toContain("Next run Tue, Oct 13 at 1:00 AM, in 7 hours.");
    expect(text()).toContain("Last run Oct 12 at 1:00 AM: 3 of 3 started.");
    expect(text()).toContain(MAINTENANCE_PATH);
    // Rich shows the prose; the front matter is the panel, not a code block.
    expect(rich()?.getText()).toContain("This run starts at night with nobody watching.");
    expect(document.querySelector(".markdown-editor-front")).toBeNull();
    expect(text()).toContain("Measure bedtime");
    expect(text()).toContain("report-writer");
    expect(document.querySelector('input[aria-label="Time"]')?.getAttribute("value") ?? (document.querySelector('input[aria-label="Time"]') as HTMLInputElement).value).toBe("01:00");
    expect(button(/^Save|^Saved/)?.disabled).toBe(true);
    expect(unsaved()).toBe(false);
  });

  it("saves the text alone, against the hash it read, when only the text changed", async () => {
    markdownView.write("source");
    await open();
    await typeCode("\nOne more rule.\n");
    expect(unsaved()).toBe(true);
    expect(text()).toContain("Saving writes the file. The next run, Tue at 1:00 AM, reads it in all 3 projects. Launches by hand read it too.");
    await press("Save");
    expect(saves()).toEqual([{ text: `${MAINTENANCE_TEXT}\nOne more rule.\n`, baseSha256: maintenanceDocument.sha256 }]);
    expect(unsaved()).toBe(false);
    expect(button(/^Saved/)?.disabled).toBe(true);
  });

  it("sends the schedule only when a side-panel value changed, with that change alone", async () => {
    await open();
    await setTime("02:00");
    expect(unsaved()).toBe(true);
    expect(text()).toContain("The next run, Tue at 2:00 AM, reads it in all 3 projects.");
    await press("Save");
    const [sent] = saves();
    expect(sent?.text).toBe(MAINTENANCE_TEXT);
    expect(sent?.baseSha256).toBe(maintenanceDocument.sha256);
    // The file's own block, with only the time changed: project names stay names, and no key is added.
    expect(sent?.schedule).toEqual({ ...maintenanceDocument.schedule, at: "02:00" });
    expect(unsaved()).toBe(false);
  });

  it("turns a changed input into an override, and Pause into paused: true", async () => {
    await open();
    const field = () => [...document.querySelectorAll("label")].find((node) => node.textContent === "Most improvements per night")?.control as HTMLInputElement | null | undefined;
    expect(field()?.value).toBe("2");
    await press("Increase Most improvements per night");
    await press("Increase Most improvements per night");
    expect(field()?.value).toBe("4");
    expect(text()).toContain("Use the file's default");
    await press("Pause");
    expect(text()).toContain("Saving writes the file and pauses the trigger.");
    await press("Save");
    expect(saves()[0]?.schedule).toEqual({ ...maintenanceDocument.schedule, paused: true, inputs: { improvements: 4 } });
  });

  it("says in Source that side-panel changes apply when you save", async () => {
    await open();
    await setTime("02:00");
    expect(text()).not.toContain("Your side-panel changes are not in this text yet.");
    await press("Source");
    expect(text()).toContain("Your side-panel changes are not in this text yet. They apply when you save");
  });

  it("asks before leaving with unsaved edits, and drops them when told to", async () => {
    await open();
    await setTime("02:00");
    await press("Triggers");
    expect(moves).toEqual([]);
    expect(text()).toContain("Discard");
    await press(/^Discard/);
    expect(moves).toEqual([{ view: "list" }]);
    expect(memory.files.size).toBe(0);
  });

  it("lists versions newest first with their source, and Restore loads the text without saving", async () => {
    markdownView.write("source");
    await open();
    await press("Versions");
    const rows = [...document.querySelectorAll(".option-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Today, 9:41 AMSaved here. On disk now", "Today, 9:20 AMChanged outside Forgerie", "Oct 9, 8:02 PMWritten by the upgrade"]);
    await press(/^Today, 9:20 AM/);
    expect(store.calls).toContainEqual(["version", maintenance.id, "v2"]);
    expect(code().state.doc.toString()).toBe(maintenanceVersions[1]?.text);
    expect(saves()).toEqual([]);
    expect(unsaved()).toBe(true);
    await press("Save");
    expect(saves()[0]).toEqual({ text: maintenanceVersions[1]?.text, baseSha256: maintenanceDocument.sha256 });
  });

  it("shows a broken file's line and what runs meanwhile, opens Source at the line, and pauses until fixed", async () => {
    await open(brokenMaintenance, { document: brokenDocument, versions: maintenanceVersions });
    expect(text()).toContain("Line 5 of the file has an error.");
    expect(text()).toContain("Tonight's run uses the last good version, saved today at 9:41 AM: every night at 1:00 AM, 3 projects.");
    await press("Show line 5");
    expect(code().state.doc.lineAt(code().state.selection.main.head).number).toBe(5);
    expect(document.querySelector(".code-editor-marked")?.textContent).toBe("  at: 1am");
    await press("Pause until fixed");
    expect(store.calls).toContainEqual(["pause", maintenance.id]);
  });

  it("explains a file without its schedule: paused, history kept", async () => {
    await open(unscheduledMaintenance, { document: unscheduledDocument });
    expect(text()).toContain("The file has no schedule now, so the trigger is paused.");
    expect(text()).toContain("Its 3 runs stay under Runs.");
  });

  it("explains a file that is gone, and offers no save", async () => {
    await open(unscheduledMaintenance, {});
    expect(text()).toContain("The file is gone, so the trigger is paused.");
    expect(text()).toContain(`Forgerie cannot find ${MAINTENANCE_PATH}.`);
    expect(document.querySelector(".cm-content, [role='textbox']")).toBeNull();
    expect(button(/^Save|^Saved/)?.disabled).toBe(true);
  });

  it("shows a refused save in the server's words with its line, and keeps the text", async () => {
    markdownView.write("source");
    await open();
    await act(async () => { code().dispatch({ changes: { from: 0, to: code().state.doc.length, insert: MAINTENANCE_TEXT.replace('"01:00"', "2am") } }); });
    await press("Save");
    expect(text()).toContain("Forgerie did not save the file. Line 5: `at` must be a time such as \"01:00\". The file says \"2am\".");
    expect(text()).toContain("Fix that line, then save again.");
    expect(document.querySelector(".code-editor-marked")?.textContent).toBe("  at: 2am");
    expect(unsaved()).toBe(true);
  });

  it("refuses to save over a file changed elsewhere, keeps the edits, and Reload drops them", async () => {
    markdownView.write("source");
    await open();
    await typeCode("\nMine.\n");
    const outside = `${MAINTENANCE_TEXT}\nTheirs.\n`;
    store.setFile(maintenance.id, { document: { ...maintenanceDocument, text: outside, sha256: "e".repeat(64) }, versions: maintenanceVersions });
    await press("Save");
    expect(text()).toContain("nightly-maintenance.md changed on disk while you were editing.");
    expect(code().state.doc.toString()).toBe(`${MAINTENANCE_TEXT}\nMine.\n`);
    await press("Reload");
    expect(code().state.doc.toString()).toBe(outside);
    expect(unsaved()).toBe(false);
  });

  it("lists each trigger with its file name, a broken file under Needs a look, and New trigger keeps the create page", async () => {
    place = { view: "list" };
    const refine: FileTrigger = { ...unscheduledMaintenance, id: "nightly-refine", name: "Nightly refinement",
      file: { path: MAINTENANCE_PATH.replace("nightly-maintenance", "nightly-refine"), status: "missing" } };
    store = memoryApi([brokenMaintenance, refine], { now: NOW });
    await act(async () => root.render(<Harness />));
    await flush();
    const groups = [...document.querySelectorAll("h2")].map((node) => node.textContent);
    expect(groups[0]).toMatch(/^Needs a look/u);
    expect(text()).toContain("nightly-maintenance.md");
    expect(text()).toContain("File has an error");
    expect(text()).toContain("nightly-refine.md");
    expect(text()).toContain("File missing");
    await press("New trigger");
    expect(moves).toEqual([{ view: "create" }]);
  });
});
