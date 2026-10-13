// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trigger } from "@shared/triggers";
import { TriggersScreen } from "./Triggers.binding";
import { useTriggerList } from "./useTriggerList";
import type { TriggerPlace } from "./triggersModel";
import { audit, digest, docs, HOST_ZONE, manyList, NOW, nightly, notes, triage } from "./fixtures/triggers";
import { memoryApi, memoryDirectory, type MemoryStore } from "./fixtures/memoryApi";
import type { TriggersApi } from "./triggersApi";

let root: Root;
let store: MemoryStore;
let place: TriggerPlace = { view: "list" };
const moves: (TriggerPlace | undefined)[] = [];
const opened: { id: string; cwd: string }[] = [];
let ids = 0;
/** The machine socket's `triggers.changed`, as the app hands it to the list. */
const changeListeners = new Set<() => void>();
const changes = (listener: () => void) => { changeListeners.add(listener); return () => { changeListeners.delete(listener); }; };
const triggersChanged = () => act(async () => { for (const listener of changeListeners) listener(); });
/** The client the screen reads through: the store's, unless a test holds a read back. */
let api: TriggersApi;

function Harness() {
  const list = useTriggerList(api, changes);
  return <TriggersScreen list={list} api={api} directory={memoryDirectory} now={() => NOW} zone={HOST_ZONE} locale="en-US"
    requestId={() => `req${String(++ids)}`}
    args={{ place, onPlace: (next) => { moves.push(next); if (next) place = next; }, onOpenSession: (session) => opened.push(session), sessionName: () => "Lockfile review" }} />;
}
const flush = () => act(async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const render = async (at: TriggerPlace, triggers: Trigger[] = [nightly, triage, notes, docs, audit, digest], off?: string) => {
  place = at;
  store = memoryApi(triggers, { now: NOW, off });
  api = store.api;
  await act(async () => root.render(<Harness />));
  await flush();
};
const rerender = async () => { await act(async () => root.render(<Harness />)); await flush(); };
const text = () => document.body.textContent ?? "";
const button = (name: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => { const label = node.getAttribute("aria-label") ?? node.textContent ?? ""; return typeof name === "string" ? label === name || node.textContent === name : name.test(label); });
const press = async (name: string | RegExp) => {
  const target = button(name);
  if (!target) throw new Error(`No button ${String(name)} in: ${text().slice(0, 400)}`);
  await act(async () => { target.click(); });
  await flush();
};
const type = async (label: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  moves.length = 0; opened.length = 0; ids = 0; changeListeners.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("the list", () => {
  it("groups problems first and words each row", async () => {
    await render({ view: "list" });
    const headings = [...document.querySelectorAll(".record-group-label")].map((node) => node.textContent);
    expect(headings).toEqual(["Needs a look", "Active", "Paused"]);
    expect(text()).toContain("Failed Oct 12: Workflow \"refine-backlog\" was not found");
    expect(text()).toContain("Missed Oct 12, 2:30 AM");
    expect(text()).toContain("Made by an agent");
    expect(text()).toContain("Starting…");
    expect(text()).toContain("No runs yet");
    expect(text()).toContain("Sundays at 4:00 AM New York time");
  });

  it("clears attention only on Mark as seen", async () => {
    await render({ view: "list" }, [nightly, triage]);
    await press(/^Nightly refinement\./);
    expect(moves).toEqual([{ view: "trigger", id: "nightly-refinement" }]);
    expect(store.triggers()[0]?.attention).not.toBeNull();
    place = { view: "list" };
    await rerender();
    await press("Mark as seen");
    expect(store.calls).toContainEqual(["acknowledge", "nightly-refinement"]);
    await flush();
    expect([...document.querySelectorAll(".record-group-label")].map((node) => node.textContent)).toEqual(["Active"]);
  });

  it("asks before Run now, sends one request ID, and shows Starting… until the history carries it", async () => {
    await render({ view: "list" }, [notes]);
    await press("Commands for Release notes");
    await press("Run now…");
    expect(text()).toContain("Run “Release notes” now?");
    expect(text()).toContain("It starts release-notes in a new session of forgerie, as a scheduled run would. The next scheduled run stays Fri, Oct 16 at 5:00 PM.");
    store.failNext("run", new TypeError("Failed to fetch"));
    await press("Run now");
    expect(text()).toContain("Press Run now to send the same request again");
    await press("Run now");
    expect(store.calls.filter((call) => call[0] === "run")).toEqual([["run", "release-notes", "req1"]]);
    expect(text()).toContain("“Release notes” is starting. Its session shows under Runs once it opens.");
    expect(text()).toContain("Starting…");
    // The server records the fire with the manual request ID: the local mark gives way to the history.
    store.set([{ ...notes, history: [{ occurrence: NOW, requestId: "trigger-release-notes-run-req1", cause: "manual", recordedAt: NOW, skippedBefore: 0,
      outcome: { kind: "started", sessionId: "s1", cwd: notes.action.cwd, runId: "r1" } }] }]);
    await press("Trigger commands");
    await press("Read triggers again");
    expect(text()).toContain("Started Oct 12, 6:00 PM by Run now");
  });

  it("says it is reading until the first list arrives, and New trigger works meanwhile", async () => {
    place = { view: "list" };
    store = memoryApi([nightly], { now: NOW });
    api = { ...store.api, list: () => new Promise(() => undefined) };
    await act(async () => root.render(<Harness />));
    await flush();
    expect(text()).toContain("Reading triggers…");
    await press("New trigger");
    expect(moves).toEqual([{ view: "create" }]);
  });

  it("says when the list cannot be read, and Retry reads it again", async () => {
    place = { view: "list" };
    store = memoryApi([triage], { now: NOW });
    api = store.api;
    store.failNext("list", new Error("Request failed: HTTP 500"));
    await act(async () => root.render(<Harness />));
    await flush();
    expect(text()).toContain("Could not read triggers: Request failed: HTTP 500");
    await press("Retry");
    expect(text()).not.toContain("Could not read triggers");
    expect(text()).toContain("Weekday triage");
  });

  it("reads the list again on triggers.changed", async () => {
    await render({ view: "list" }, [triage]);
    store.set([triage, { ...notes, name: "Weekly notes" }]);
    await triggersChanged();
    await flush();
    expect(text()).toContain("Weekly notes");
    expect(store.calls.filter((call) => call[0] === "list")).toHaveLength(2);
  });

  it("says when the store is off and keeps New trigger", async () => {
    await render({ view: "list" }, [], "database is locked");
    expect(text()).toContain("Triggers are off: database is locked. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond.");
    expect(button("New trigger")).toBeDefined();
  });

  it("offers a filter from nine triggers and totals them", async () => {
    await render({ view: "list" }, manyList.triggers);
    expect(text()).toContain("23 triggers, 4 paused");
    await type("Filter by name, project, or workflow", "zzz");
    expect(text()).toContain("No triggers match “zzz”.");
  });
});

describe("a trigger's page", () => {
  it("leads with the attention card and opens the last session from Runs", async () => {
    await render({ view: "trigger", id: "nightly-refinement" });
    expect(store.calls).toContainEqual(["get", "nightly-refinement"]);
    expect(text()).toContain("The Oct 12, 3:00 AM run failed.");
    expect(text()).toContain("2 runs had problems since Oct 11.");
    expect(text()).toContain("Next run Tue, Oct 13 at 3:00 AM, in 9 hours.");
    expect(text()).toContain("Also covers 2 earlier runs that passed while Forgerie was off.");
    await press("Open session");
    expect(opened[0]?.cwd).toBe(nightly.action.cwd);
  });

  it("saves only the changed field against the revision it read", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Weekday issue triage");
    expect(text()).toContain("Unsaved changes");
    await press("Save");
    expect(store.calls).toContainEqual(["update", "weekday-triage", { baseRevision: 12, name: "Weekday issue triage" }]);
    expect(text()).toContain("Saved");
  });

  it("shows the conflict when someone else changed the trigger first, and Reload drops the draft", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    store.set([{ ...triage, name: "Theirs", revision: 13 }]);
    await press("Save");
    expect(text()).toContain("This trigger changed while you were editing");
    await press("Reload");
    expect((document.querySelector<HTMLInputElement>('input[aria-label="Trigger name"]'))?.value).toBe("Theirs");
  });

  it("says when a paused trigger would run next, and resumes it", async () => {
    await render({ view: "trigger", id: "docs-sweep" });
    expect(text()).toContain("Paused since Oct 10. If you resume now, the next run is Sun, Oct 18 at 4:00 AM New York time.");
    expect(text()).toContain("Last run Oct 4 at 4:00 AM New York time was missed.");
    await press("Resume");
    expect(store.calls).toContainEqual(["resume", "docs-sweep"]);
    expect(text()).toContain("Next run Tue, Oct 13 at 5:00 AM New York time, in 9 hours.");
  });

  it("shows a run the server has started as Starting…, across a reload", async () => {
    await render({ view: "trigger", id: "inbox-digest" });
    expect(text()).toContain("Last run Oct 12 at 5:58 PM is starting.");
    expect([...document.querySelectorAll(".action-row-status")].map((node) => node.textContent)).toEqual(["Starting…", "Started"]);
  });

  it("warns at once when another change reaches the fields being edited, and the save is refused", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    store.set([{ ...triage, schedule: { ...triage.schedule, at: "10:00" }, revision: 13 }]);
    await triggersChanged();
    await flush();
    expect(text()).toContain("This trigger changed while you were editing");
    await press("Save");
    expect(store.calls.filter((call) => call[0] === "update")).toEqual([["update", "weekday-triage", expect.objectContaining({ baseRevision: 12 })]]);
    expect(store.triggers()[0]?.name).toBe("Weekday triage");
    // Drafts outlive the page, so this one goes before the next test reads the same trigger.
    await press("Reload");
    expect(text()).not.toContain("Unsaved changes");
  });

  it("keeps the draft and saves when only a run or a pause raised the revision", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    store.set([{ ...triage, state: { kind: "paused", pausedAt: NOW }, revision: 13 }]);
    await triggersChanged();
    await flush();
    expect(text()).not.toContain("This trigger changed while you were editing");
    await press("Save");
    expect(store.calls).toContainEqual(["update", "weekday-triage", { baseRevision: 13, name: "Mine" }]);
    expect(text()).toContain("Saved");
  });

  it("says when no trigger has the ID", async () => {
    await render({ view: "trigger", id: "gone" });
    expect(text()).toContain("No trigger has this ID. It may have been deleted.");
  });

  it("names an agent's trigger and links its session", async () => {
    await render({ view: "trigger", id: "dependency-audit" });
    expect(text()).toContain("Created by an agent in “Lockfile review”.");
    expect(text()).toContain("The Oct 12, 2:30 AM run was missed.");
  });

  it("asks before deleting, then goes back to the list", async () => {
    await render({ view: "trigger", id: "release-notes" });
    await press("Trigger commands");
    await press("Delete trigger…");
    await press("Delete trigger");
    expect(store.calls).toContainEqual(["remove", "release-notes"]);
    expect(moves.at(-1)).toEqual({ view: "list" });
    expect(text()).toContain("Deleted “Release notes”.");
  });
});

describe("the create page", () => {
  it("lists what is missing instead of sending, then creates without an ID", async () => {
    await render({ view: "create" });
    await press("Create");
    expect(store.calls.some((call) => call[0] === "create")).toBe(false);
    expect(text()).toContain("Give the trigger a name.");
    expect(text()).toContain("Choose a project.");
    await type("Trigger name", "Nightly docs");
    await press("Choose a project");
    await press(/^forgerie/);
    await press(/^Workflow:/);
    await press(/^docs-sweep/);
    await press("Create");
    const create = store.calls.find((call) => call[0] === "create")?.[1];
    expect(create).toEqual({ name: "Nightly docs", schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
      action: { kind: "workflow", cwd: nightly.action.cwd, workflow: "docs-sweep", inputs: {} }, missedGraceMinutes: 360 });
    expect(moves.at(-1)).toEqual({ view: "trigger", id: "nightly-docs" });
    expect(text()).toContain("Created “Nightly docs”. Next run Tue, Oct 13 at 3:00 AM.");
  });
});
