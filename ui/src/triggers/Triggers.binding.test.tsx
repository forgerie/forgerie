// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trigger, TriggerFire } from "@shared/triggers";
import { TriggersScreen } from "./Triggers.binding";
import { useTriggerList } from "./useTriggerList";
import type { TriggerPlace } from "./triggersModel";
import { audit, CALIPER, digest, docs, everywhere, FORGERIE, HOST_ZONE, manyList, NOW, nightly, notes, PI_MONO, spreadNotes, triage } from "./fixtures/triggers";
import { memoryApi, memoryDirectory, serverRunId, type MemoryStore } from "./fixtures/memoryApi";
import { TriggerRefusal, type TriggersApi } from "./triggersApi";
import { createTriggerMemory, type TriggerMemory } from "./triggerMemory";

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
/** Drafts and pending runs: each test owns its own, so none leaks into the next. */
let memory: TriggerMemory;
/** The client the screen reads through: the store's, unless a test holds a read back. */
let api: TriggersApi;

function Harness() {
  const list = useTriggerList(api, changes);
  return <TriggersScreen list={list} api={api} directory={memoryDirectory} memory={memory} now={() => NOW} zone={HOST_ZONE} locale="en-US"
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
/** The field named `label`: an input by its accessible name, or a text box by its label. */
const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  ?? [...document.querySelectorAll("label")].find((node) => node.textContent === label)?.control as HTMLInputElement | HTMLTextAreaElement | null | undefined;
/** A checkbox in the project picker, by the project's name. */
const checkbox = (name: string) => [...document.querySelectorAll("label")].find((node) => node.querySelector(".choice-list-label")?.textContent === name)
  ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
const check = async (name: string) => {
  const box = checkbox(name);
  if (!box) throw new Error(`No checkbox ${name} in: ${text().slice(0, 400)}`);
  await act(async () => { box.click(); });
  await flush();
};
/** Opens the project picker, checks each project named, and closes it with Done. */
const chooseProjects = async (...names: string[]) => {
  await press(/^Target projects:/);
  for (const name of names) await check(name);
  await press("Done");
};
const type = async (label: string, value: string) => {
  const input = field(label);
  if (!input) throw new Error(`No field ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  moves.length = 0; opened.length = 0; ids = 0; changeListeners.clear(); memory = createTriggerMemory();
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
    // An entry whose ID the browser could have built from its own request is not this run: the mark stays.
    const manual = (requestId: string, outcome: TriggerFire["outcome"]): TriggerFire => ({ occurrence: NOW, requestId, cause: "manual", recordedAt: NOW, skippedBefore: 0, outcome,
      projects: [{ cwd: FORGERIE, outcome: outcome.kind === "started" ? { kind: "started", sessionId: outcome.sessionId, runId: outcome.runId } : { kind: "running", startedAt: NOW } }] });
    store.set([{ ...notes, history: [manual("trigger-release-notes-run-req1", { kind: "started", sessionId: "s0", cwd: FORGERIE, runId: "r0" })] }]);
    await press("Trigger commands");
    await press("Read triggers again");
    expect(document.querySelector(".record-row-outcome")?.textContent).toBe("Starting…");
    // The server's running entry carries the ID its 202 answer returned: the history takes over from the local mark.
    store.set([{ ...notes, history: [manual(serverRunId("release-notes", "req1"), { kind: "running", startedAt: NOW })] }]);
    await press("Trigger commands");
    await press("Read triggers again");
    expect(document.querySelector(".record-row-outcome")?.textContent).toBe("Starting…");
    expect(document.querySelectorAll('.mark-strip-mark[data-tone="live"]')).toHaveLength(1);
    store.set([{ ...notes, history: [manual(serverRunId("release-notes", "req1"), { kind: "started", sessionId: "s1", cwd: FORGERIE, runId: "r1" })] }]);
    await press("Trigger commands");
    await press("Read triggers again");
    expect(text()).toContain("Started Oct 12, 6:00 PM by Run now");
    expect(text()).not.toContain("Starting…");
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

  it("draws no rows once the store goes off, even after a good read", async () => {
    await render({ view: "list" }, [triage]);
    expect(text()).toContain("Weekday triage");
    store.failNext("list", new TriggerRefusal("database is locked", 503));
    await triggersChanged();
    await flush();
    expect(text()).toContain("Triggers are off. Database is locked.");
    expect(text()).not.toContain("Weekday triage");
    expect(document.querySelector(".record-row")).toBeNull();
  });

  it("says when the store is off and keeps New trigger", async () => {
    await render({ view: "list" }, [], "database is locked");
    expect(text()).toContain("Triggers are off. Database is locked. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond.");
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
    expect(document.querySelector(".alert-card-title")?.textContent).toBe("Failed Oct 12, 3:00 AM");
    expect(text()).toContain("2 runs had problems since Oct 11.");
    expect(text()).toContain("Next run Tue, Oct 13 at 3:00 AM, in 9 hours.");
    expect(text()).toContain("Also covers 2 earlier runs that passed while Forgerie was off.");
    await press("Open session");
    expect(opened[0]?.cwd).toBe(FORGERIE);
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
    expect(text()).toContain("This trigger changed while you were editing. Forgerie cannot save over that change. Reload shows the new version and discards your changes.");
    await press("Reload");
    expect((document.querySelector<HTMLInputElement>('input[aria-label="Trigger name"]'))?.value).toBe("Theirs");
  });

  it("says when a paused trigger would run next, and resumes it", async () => {
    await render({ view: "trigger", id: "docs-sweep" });
    expect(text()).toContain("Paused since Oct 10. If you resume now, the next run is Sun, Oct 18 at 4:00 AM New York time.");
    expect(text()).toContain("Last run Oct 4 at 4:00 AM New York time was missed.");
    // The Runs list names the zone once, in its heading, not on every row.
    expect([...document.querySelectorAll(".action-row-name")].map((node) => node.textContent)).toEqual(["Sun, Oct 4, 4:00 AM", "Sun, Sep 27, 4:00 AM"]);
    expect(document.querySelector(".list-section-aside")?.textContent).toContain("New York time");
    expect(document.querySelector(".action-row")?.getAttribute("data-layout")).toBe("head");
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
    // Reload drops the draft.
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

  it("never turns a save of a deleted trigger into a create", async () => {
    await render({ view: "trigger", id: "weekday-triage" }, [triage, notes]);
    await type("Trigger name", "Mine");
    store.set([notes]);
    await triggersChanged();
    await flush();
    expect(text()).toContain("No trigger has this ID. It may have been deleted.");
    expect(button("Save")).toBeUndefined();
    await saveKey();
    await flush();
    expect(store.calls.filter((call) => call[0] === "create" || call[0] === "update")).toEqual([]);
    expect(store.triggers().map((trigger) => trigger.id)).toEqual(["release-notes"]);
  });

  it("keeps the new-trigger draft apart from a trigger whose ID is create", async () => {
    const named: Trigger = { ...notes, id: "create", name: "Create release notes" };
    await render({ view: "create" }, [named]);
    await type("Trigger name", "My new trigger");
    place = { view: "trigger", id: "create" };
    await rerender();
    expect(field("Trigger name")?.value).toBe("Create release notes");
    expect(text()).not.toContain("Unsaved changes");
    place = { view: "create" };
    await rerender();
    expect(field("Trigger name")?.value).toBe("My new trigger");
  });

  it("moves focus to the field a server refusal names, and links the problem to it", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    store.failNext("update", new TriggerRefusal("Choose a time Forgerie can keep.", 400, "schedule.at"));
    await press("Save");
    const time = document.activeElement as HTMLInputElement;
    expect(time.type).toBe("time");
    expect(describedBy(time)).toContain("Choose a time Forgerie can keep.");
  });

  it("closes an open picker when a save starts, and a choice during the save changes nothing", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    await press(/^Time zone:/);
    const newYork = button(/^New York \(America\/New_York\)/);
    expect(newYork).toBeDefined();
    const held = store.hold("update");
    await saveKey();
    // The panel is gone at once; a press on the option it showed reaches nothing.
    expect(button(/^New York \(America\/New_York\)/)).toBeUndefined();
    expect(document.querySelector('[role="dialog"][aria-label="Time zone"]')).toBeNull();
    await act(async () => newYork?.click());
    expect(button(/^Time zone:/)?.getAttribute("aria-label")).toBe("Time zone: Denver (America/Denver)");
    await act(async () => held.release());
    await flush();
    expect(store.calls.filter((call) => call[0] === "update")).toEqual([["update", "weekday-triage", { baseRevision: 12, name: "Mine" }]]);
    expect(text()).toContain("Saved");
    expect(text()).not.toContain("Unsaved changes");
    expect(button(/^Time zone:/)?.getAttribute("aria-label")).toBe("Time zone: Denver (America/Denver)");
  });

  it("closes the project picker when a save starts", async () => {
    await render({ view: "trigger", id: "weekday-triage" });
    await type("Trigger name", "Mine");
    await press("Target projects: Runs in pi-mono");
    expect(checkbox("forgerie")).toBeDefined();
    const held = store.hold("update");
    await saveKey();
    expect(checkbox("forgerie")).toBeUndefined();
    await act(async () => held.release());
    await flush();
    expect(store.calls.filter((call) => call[0] === "update")).toEqual([["update", "weekday-triage", { baseRevision: 12, name: "Mine" }]]);
    expect(store.triggers().find((trigger) => trigger.id === "weekday-triage")?.action.targets).toEqual(triage.action.targets);
  });

  it("says when no trigger has the ID", async () => {
    await render({ view: "trigger", id: "gone" });
    expect(text()).toContain("No trigger has this ID. It may have been deleted.");
  });

  it("names an agent's trigger and links its session", async () => {
    await render({ view: "trigger", id: "dependency-audit" });
    expect(text()).toContain("An agent made this trigger in “Lockfile review”.");
    expect(text()).not.toContain("without your confirmation");
    await press("Open the agent's session");
    expect(opened.at(-1)).toEqual({ id: audit.createdBy.kind === "agent" ? audit.createdBy.sessionId : "", cwd: FORGERIE });
    expect(document.querySelector(".alert-card-title")?.textContent).toBe("Missed Oct 12, 2:30 AM");
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

/** Disabled itself, or inside a disabled fieldset, as a browser reads `:disabled`. */
const locked = (control: Element) => (control as HTMLButtonElement).disabled || control.closest("fieldset")?.disabled === true;
/** Ctrl+S, as the page's shortcut hears it. */
const saveKey = () => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); });

/** The words an element's aria-describedby points at. */
const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");

describe("the create page", () => {
  it("moves focus to an input with a problem, and links the problem to it", async () => {
    await render({ view: "create" }, []);
    await type("Trigger name", "Nightly docs");
    await chooseProjects("forgerie");
    await press(/^Workflow:/);
    await press(/^refine-backlog/);
    await press("Create");
    expect(store.calls.some((call) => call[0] === "create")).toBe(false);
    const task = document.activeElement as HTMLTextAreaElement;
    expect(task.tagName).toBe("TEXTAREA");
    expect(describedBy(task)).toContain("Fill in task.");
  });

  it("sends one create for repeated saves, and locks the form while it is in flight", async () => {
    await render({ view: "create" }, []);
    await type("Trigger name", "Nightly docs");
    await chooseProjects("forgerie");
    await press(/^Workflow:/);
    await press(/^triage-issues/);
    await type("Task", "Triage the new issues.");
    const held = store.hold("create");
    await saveKey();
    await saveKey();
    expect(button("Creating…")?.disabled).toBe(true);
    // Every control that edits the draft is locked until the answer comes.
    for (const name of ["Some days", "1 day", "bug", "Nightly docs"]) {
      const control = button(name) ?? document.querySelector<HTMLInputElement>(`input[value="${name}"]`);
      expect(control ? locked(control) : undefined, name).toBe(true);
    }
    expect(locked(document.querySelector("textarea")!)).toBe(true);
    await act(async () => held.release());
    await flush();
    expect(store.calls.filter((call) => call[0] === "create")).toHaveLength(1);
    expect(store.triggers()).toHaveLength(1);
  });

  it("fails with the store's own words when the store is off", async () => {
    await render({ view: "create" }, []);
    store.failNext("create", new TriggerRefusal("database is locked", 503));
    await type("Trigger name", "Nightly docs");
    await chooseProjects("forgerie");
    await press(/^Workflow:/);
    await press(/^docs-sweep/);
    await press("Create");
    expect(text()).toContain("Triggers are off. Database is locked. No trigger runs until sessiond can open its store.");
    expect((document.querySelector<HTMLInputElement>('input[aria-label="Trigger name"]'))?.value).toBe("Nightly docs");
    // Discard drops the draft and leaves the create page.
    await press("Trigger commands");
    await press("Discard");
    expect(moves.at(-1)).toEqual({ view: "list" });
  });

  it("lists what is missing instead of sending, then creates without an ID", async () => {
    await render({ view: "create" });
    await press("Create");
    expect(store.calls.some((call) => call[0] === "create")).toBe(false);
    expect(text()).toContain("Give the trigger a name.");
    expect(text()).toContain("Choose at least one project, or All projects.");
    await type("Trigger name", "Nightly docs");
    await chooseProjects("forgerie");
    await press(/^Workflow:/);
    await press(/^docs-sweep/);
    await press("Create");
    const create = store.calls.find((call) => call[0] === "create")?.[1];
    expect(create).toEqual({ name: "Nightly docs", schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
      action: { kind: "workflow", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "docs-sweep", inputs: {} }, missedGraceMinutes: 360 });
    expect(moves.at(-1)).toEqual({ view: "trigger", id: "nightly-docs" });
    expect(text()).toContain("Created “Nightly docs”. Next run Tue, Oct 13 at 3:00 AM.");
  });
});

/** The problem under a field's row, by the field's label. */
const problemOf = (label: string) => [...document.querySelectorAll(".agent-field")]
  .find((row) => row.querySelector(".agent-field-label")?.textContent === label)?.querySelector(".agent-field-problem")?.textContent;
const hintOf = (label: string) => [...document.querySelectorAll(".agent-field")]
  .find((row) => row.querySelector(".agent-field-label")?.textContent === label)?.querySelector(".agent-field-hint")?.textContent;

describe("target projects", () => {
  it("picks several projects or All projects, lists only the workflows they share, and creates with them", async () => {
    await render({ view: "create" }, []);
    await type("Trigger name", "Weekly notes everywhere");
    await chooseProjects("forgerie", "pi-mono");
    expect(button(/^Target projects:/)?.getAttribute("aria-label")).toBe("Target projects: Runs in 2 projects");
    expect(hintOf("Project")).toBe("Each run starts a new session in each of these projects, at once.");
    // One read per selection, whatever order the projects were checked in.
    expect(store.calls).toContainEqual(["commonWorkflows", { kind: "projects", cwds: [PI_MONO, FORGERIE] }]);
    expect(hintOf("Workflow")).toBe("Only workflows every target project can run are listed. Global workflows run in every project.");
    await press(/^Workflow:/);
    // refine-backlog is forgerie's own: it is listed only to say why it cannot be chosen.
    expect(button(/^refine-backlog/)?.textContent).toContain("Missing in pi-mono");
    expect(button(/^release-notes/)).toBeDefined();
    await press(/^release-notes/);
    // All projects: every row shows checked and cannot change one by one; projects added later are included.
    await press(/^Target projects:/);
    await check("All projects");
    expect(checkbox("caliper")?.checked).toBe(true);
    expect(checkbox("caliper")?.disabled).toBe(true);
    await press("Done");
    expect(button(/^Target projects:/)?.getAttribute("aria-label")).toBe("Target projects: Runs in all projects");
    expect(hintOf("Project")).toContain("Projects added later are included.");
    await press("Create");
    expect(store.calls.find((call) => call[0] === "create")?.[1]).toMatchObject({ action: { targets: { kind: "all" }, workflow: "release-notes" } });
  });

  it("gives back the fixed list when All projects is turned off, and asks for at least one project", async () => {
    await render({ view: "trigger", id: spreadNotes.id }, [spreadNotes]);
    await press(/^Target projects:/);
    await check("All projects");
    await check("All projects");
    expect(["forgerie", "pi-mono", "caliper"].map((name) => checkbox(name)?.checked)).toEqual([true, true, true]);
    await check("forgerie"); await check("pi-mono"); await check("caliper");
    await press("Done");
    expect(button(/^Target projects:/)?.getAttribute("aria-label")).toBe("Target projects: Runs in Choose projects");
    await press("Save");
    expect(store.calls.some((call) => call[0] === "update")).toBe(false);
    expect(problemOf("Project")).toBe("Choose at least one project, or All projects.");
  });

  it("keeps a workflow the new selection does not share, says why at once, and will not save it", async () => {
    await render({ view: "trigger", id: nightly.id });
    await chooseProjects("pi-mono");
    expect(button(/^Workflow:/)?.getAttribute("aria-label")).toBe("Workflow: refine-backlog");
    expect(problemOf("Workflow")).toBe("“refine-backlog” cannot run in every target project. It is missing in pi-mono. Choose another workflow, or change the projects.");
    await press("Save");
    expect(store.calls.some((call) => call[0] === "update")).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Workflow: refine-backlog");
    // caliper has the same refine-backlog: swap pi-mono for it and the workflow is common again.
    await chooseProjects("pi-mono", "caliper");
    expect(problemOf("Workflow")).toBeUndefined();
    await press("Save");
    expect(store.calls.find((call) => call[0] === "update")?.[2]).toMatchObject({ action: { targets: { kind: "projects", cwds: [FORGERIE, CALIPER] }, workflow: "refine-backlog" } });
  });

  it("names a workflow whose inputs differ in another project", async () => {
    await render({ view: "trigger", id: triage.id });
    await chooseProjects("forgerie");
    expect(problemOf("Workflow")).toContain("Its inputs differ between pi-mono and forgerie.");
  });
});

describe("a fire in several projects", () => {
  it("counts the projects on the last-run line and lists each one, failures first, unavailable ones quiet", async () => {
    await render({ view: "trigger", id: everywhere.id }, [everywhere]);
    expect(text()).toContain("Last run Oct 12 at 4:00 AM: 2 of 4 started, 1 failed, 1 unavailable.");
    const status = document.querySelector('[aria-label="Outcome in each project"]')!;
    const rows = [...status.querySelectorAll(":scope > .action-row")];
    expect(rows.map((row) => [row.querySelector(".action-row-name")?.textContent, row.querySelector(".action-row-status")?.textContent]))
      .toEqual([["pi-mono", "Failed"], ["forgerie", "Started"], ["caliper", "Started"], ["old-site", "Unavailable"]]);
    expect(rows.map((row) => row.getAttribute("data-tone"))).toEqual([null, null, null, "quiet"]);
    expect(rows[3]?.textContent).toContain("ENOENT: no such file or directory");
    // Each project that has a session opens it: the failed one too, since its session exists.
    expect(rows.map((row) => row.querySelector("button")?.textContent ?? null)).toEqual(["Open session", "Open session", "Open session", null]);
    await act(async () => rows[2]?.querySelector("button")?.click());
    expect(opened.at(-1)).toEqual({ id: expect.stringContaining("nightly-docs") as string, cwd: CALIPER });
    expect(text()).toContain("Failed in pi-mono: 2 of 4 started, 1 failed, 1 unavailable.");
  });

  it("counts each run in the history and opens its projects on request", async () => {
    await render({ view: "trigger", id: everywhere.id }, [everywhere]);
    const runs = () => [...document.querySelectorAll(".list-section .list-section-rows > .action-row")];
    expect(runs().map((row) => row.querySelector(".action-row-status")?.textContent)).toEqual(["2 of 4 started", "3 of 4 started", "4 of 4 started"]);
    expect(runs()[1]?.querySelector(".action-row-detail")?.textContent).toBe("Scheduled. 1 unavailable.");
    expect(runs()[1]?.querySelector(".action-row-status")?.getAttribute("data-tone")).toBeNull();
    const toggle = runs()[1]?.querySelector<HTMLButtonElement>("button");
    expect(toggle?.textContent).toBe("Projects");
    await act(async () => toggle?.click());
    await flush();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect([...runs()[1]!.querySelectorAll(".action-row-below .action-row-name")].map((node) => node.textContent)).toEqual(["forgerie", "pi-mono", "caliper", "old-site"]);
  });

  it("words the list row by count and names the target projects", async () => {
    await render({ view: "list" }, [everywhere, spreadNotes]);
    expect(text()).toContain("Oct 12, 4:00 AM: 2 of 4 started, 1 failed, 1 unavailable");
    expect(text()).toContain("All projects");
    expect(text()).toContain("3 projects");
    expect(button(/^Weekly release notes\./)?.getAttribute("aria-label")).toContain("Runs in 3 projects.");
  });
});

describe("a fire that failed in one project while others still start", () => {
  // pi-mono failed, forgerie started, caliper is still starting. The server set attention at the failure, after it
  // recorded the running fire, and the fire's summary still says running.
  const admitted = NOW - 5 * 60_000;
  const held: Trigger = { ...spreadNotes, attention: { since: admitted + 60_000 }, history: [{
    occurrence: admitted, requestId: "trigger-weekly-release-notes-held", cause: "schedule", recordedAt: admitted, skippedBefore: 0,
    outcome: { kind: "running", startedAt: admitted },
    projects: [
      { cwd: FORGERIE, outcome: { kind: "started", sessionId: "s-forgerie", runId: "r1" } },
      { cwd: PI_MONO, outcome: { kind: "failed", error: "Session could not start: the workspace is locked.", sessionId: "s-pi", failedAt: admitted + 60_000 } },
      { cwd: CALIPER, outcome: { kind: "running", startedAt: admitted } },
    ] }, ...spreadNotes.history] };

  it("keeps A's acknowledged error hidden when overlapping fire B fails later", async () => {
    const starting = (id: string, at: number): TriggerFire => ({
      occurrence: at, requestId: id, cause: "manual", recordedAt: at, skippedBefore: 0,
      outcome: { kind: "running", startedAt: at }, projects: [FORGERIE, PI_MONO].map((cwd) => ({ cwd, outcome: { kind: "running", startedAt: at } })),
    });
    const publish = async (history: TriggerFire[], attention: Trigger["attention"]) => {
      const current = store.triggers()[0]!;
      store.set([{ ...current, revision: current.revision + 1, history, attention }]);
      await triggersChanged();
      await flush();
    };
    const b = starting("B", NOW - 6 * 60_000);
    await render({ view: "trigger", id: held.id }, [{ ...held, attention: null, history: [b] }]);
    const a = starting("A", NOW - 5 * 60_000);
    await publish([a, b], null);
    const failedA: TriggerFire = { ...a, projects: [
      { cwd: FORGERIE, outcome: { kind: "failed", failedAt: NOW - 4 * 60_000, error: "Already-seen A error", sessionId: "s-A" } }, a.projects[1]!,
    ] };
    await publish([failedA, b], { since: NOW - 4 * 60_000 });
    expect(document.querySelector(".alert-card")?.textContent).toContain("Already-seen A error");
    await press("Mark as seen");
    expect(document.querySelector(".alert-card")).toBeNull();
    const failedB: TriggerFire = { ...b, projects: [
      { cwd: FORGERIE, outcome: { kind: "failed", failedAt: NOW - 2 * 60_000, error: "New unseen B error", sessionId: "s-B" } }, b.projects[1]!,
    ] };
    await publish([failedA, failedB], { since: NOW - 2 * 60_000 });
    const card = document.querySelector(".alert-card")?.textContent;
    expect(card).toContain("New unseen B error");
    expect(card).not.toContain("Already-seen A error");
    expect(card).not.toContain("2 runs had problems");
    await press("Open session");
    expect(opened.at(-1)).toEqual({ id: "s-B", cwd: FORGERIE });
  });

  it("shows no attention card for an acknowledged failure while a sibling still starts", async () => {
    await render({ view: "trigger", id: held.id }, [{ ...held, attention: null }]);
    expect(document.querySelector(".alert-card")).toBeNull();
    expect(button("Mark as seen")).toBeUndefined();
  });

  it("shows the newest unseen project error rather than a fire's first failed project", async () => {
    const fire = held.history[0]!;
    const history: TriggerFire[] = [{ ...fire, outcome: { kind: "failed", error: "Already-seen project error", cwd: FORGERIE, sessionId: "seen" }, projects: [
      { cwd: FORGERIE, outcome: { kind: "failed", failedAt: admitted, error: "Already-seen project error", sessionId: "seen" } },
      { cwd: PI_MONO, outcome: { kind: "failed", failedAt: admitted + 60_000, error: "Earlier unseen error", sessionId: "earlier" } },
      { cwd: CALIPER, outcome: { kind: "failed", failedAt: admitted + 120_000, error: "Newest unseen error", sessionId: "newest" } },
    ] }];
    await render({ view: "trigger", id: held.id }, [{ ...held, history }]);
    const card = document.querySelector(".alert-card")?.textContent;
    expect(card).toContain("Newest unseen error");
    expect(card).toContain("Failed in caliper and pi-mono:");
    expect(card).toContain("The error below is from caliper.");
    expect(card).not.toContain("Already-seen project error");
    expect(card).not.toContain("Earlier unseen error");
    await press("Open session");
    expect(opened.at(-1)).toEqual({ id: "newest", cwd: CALIPER });
  });

  it("shows the attention card with the failed project, says the rest still start, and marks it as seen", async () => {
    await render({ view: "trigger", id: held.id }, [held]);
    expect(document.querySelector(".alert-card-title")?.textContent).toBe("Failed Oct 12, 5:55 PM");
    expect(text()).toContain("Failed in pi-mono: 1 of 3 started, 1 failed, 1 still starting.");
    expect(text()).toContain("1 project is still starting.");
    expect(text()).toContain("Session could not start: the workspace is locked.");
    await press("Open session");
    expect(opened.at(-1)).toEqual({ id: "s-pi", cwd: PI_MONO });
    await press("Mark as seen");
    expect(store.calls).toContainEqual(["acknowledge", held.id]);
    expect(document.querySelector(".alert-card")).toBeNull();
  });

  it("puts the trigger under Needs a look, in the bad tone, with what settled so far", async () => {
    await render({ view: "list" }, [held]);
    expect([...document.querySelectorAll(".record-group-label")].map((node) => node.textContent)).toEqual(["Needs a look"]);
    expect(document.querySelector(".record-row-outcome")?.textContent).toBe("Starting… 1 of 3 started, 1 failed, 1 still starting");
  });
});

describe("Run now with several projects", () => {
  it("runs in every target project by default, sending no cwd", async () => {
    await render({ view: "trigger", id: spreadNotes.id }, [spreadNotes]);
    await press("Run now…");
    expect(text()).toContain("It starts release-notes in a new session of each of 3 projects, at once: forgerie, pi-mono, and caliper.");
    expect(button("All target projects")?.getAttribute("aria-pressed")).toBe("true");
    await press("Run now");
    expect(store.calls.filter((call) => call[0] === "run")).toEqual([["run", spreadNotes.id, "req1"]]);
    expect(text()).toContain("“Weekly release notes” is starting in each target project.");
  });

  it("runs in one project when the reader picks it, and keeps that choice for a retry", async () => {
    await render({ view: "trigger", id: spreadNotes.id }, [spreadNotes]);
    await press("Run now…");
    await press("One project");
    // No project picked yet: Run now waits for one.
    expect(button("Run now")?.disabled).toBe(true);
    expect(text()).toContain("Choose the project to run in.");
    await press("pi-mono");
    expect(text()).toContain("It starts release-notes in a new session of pi-mono only. The trigger keeps its target projects.");
    store.failNext("run", new TypeError("Failed to fetch"));
    await press("Run now");
    // The retry reuses the request ID, so the server keeps its first choice: the choice is locked to match.
    expect(button("All target projects")?.disabled).toBe(true);
    expect(button("caliper")?.disabled).toBe(true);
    await press("Run now");
    expect(store.calls.filter((call) => call[0] === "run")).toEqual([["run", spreadNotes.id, "req1", PI_MONO]]);
    expect(text()).toContain("“Weekly release notes” is starting in pi-mono.");
  });

  it("leaves the choice open after a refusal, which admitted nothing", async () => {
    await render({ view: "trigger", id: spreadNotes.id }, [spreadNotes]);
    await press("Run now…");
    await press("One project");
    await press("pi-mono");
    store.failNext("run", new TriggerRefusal("Choose a workspace of a registered project", 400, "cwd"));
    await press("Run now");
    expect(text()).toContain("Could not run “Weekly release notes”: Choose a workspace of a registered project");
    expect(button("caliper")?.disabled).toBe(false);
    await press("caliper");
    await press("Run now");
    expect(store.calls.filter((call) => call[0] === "run")).toEqual([["run", spreadNotes.id, "req1", CALIPER]]);
  });

  it("keeps the choice locked after a lost answer, even when a later retry is refused", async () => {
    await render({ view: "trigger", id: spreadNotes.id }, [spreadNotes]);
    await press("Run now…");
    await press("One project");
    await press("pi-mono");
    store.failNext("run", new TypeError("Failed to fetch"));
    await press("Run now");
    // The first request may have reached the server, which keeps its projects: the choice locks.
    expect(button("All target projects")?.disabled).toBe(true);
    store.failNext("run", new TriggerRefusal("database is locked", 503));
    await press("Run now");
    expect(text()).toContain("Could not run “Weekly release notes”: database is locked");
    // The 503 says nothing about the lost request, so the choice stays locked and still reads pi-mono.
    expect(button("All target projects")?.disabled).toBe(true);
    expect(button("caliper")?.disabled).toBe(true);
    await press("All target projects");
    expect(text()).toContain("It starts release-notes in a new session of pi-mono only.");
    await press("Run now");
    expect(store.calls.filter((call) => call[0] === "run")).toEqual([["run", spreadNotes.id, "req1", PI_MONO]]);
  });

  it("offers every registered project for a trigger on All projects", async () => {
    await render({ view: "trigger", id: everywhere.id }, [everywhere]);
    await press("Run now…");
    expect(button("All projects")?.getAttribute("aria-pressed")).toBe("true");
    await press("One project");
    expect(["forgerie", "pi-mono", "caliper"].map((name) => button(name) !== undefined)).toEqual([true, true, true]);
  });

  it("keeps one project's question as it was", async () => {
    await render({ view: "trigger", id: notes.id }, [notes]);
    await press("Run now…");
    expect(button("One project")).toBeUndefined();
  });
});
