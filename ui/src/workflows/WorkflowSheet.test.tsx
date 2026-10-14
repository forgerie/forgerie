// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowSheet } from "./WorkflowSheet";
import { setWorkerModel } from "./workflowRoute";
import type { WorkflowStartView } from "./WorkflowStartView";
import type { WorkflowRunView } from "./WorkflowRunView";
import { PROPOSAL_STAGES, READ_FAILED, REPLACED_PROPOSAL, START_REFUSED } from "./fixtures/proposals";
import {
  AGENTS, API_TRANSCRIPT, LOOKS, PROSE, PROSE_RUN, RICH_ENTRY, RICH_PROPOSAL, RUN_AT_STOP, RUN_FINISHED, RUN_WORKING, SAVED_RICH, SHEET_NOW, WORKER_MODELS,
} from "./fixtures/sheet";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const sheet = () => document.querySelector("dialog")!;
const button = (name: string) => [...sheet().querySelectorAll<HTMLButtonElement>("button")]
  .find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
const press = async (name: string) => {
  const target = button(name);
  if (target === undefined) throw new Error(`No button ${name}`);
  await act(async () => { target.click(); });
};
const text = () => sheet().textContent ?? "";
const note = () => sheet().querySelector(".action-footer-note")?.textContent ?? "";
const problem = () => sheet().querySelector(".action-footer-problem")?.textContent ?? "";
const pane = (label: string) => sheet().querySelector(`[aria-label="${label}"]`);
/** Each section's number as drawn, then its title. */
const headings = () => [...sheet().querySelectorAll(".numbered-sections-heading")]
  .map((heading) => `${heading.querySelector(".numbered-sections-number")?.textContent ?? ""}${heading.querySelector(".numbered-sections-title")?.textContent ?? ""}`);
const type = async (field: HTMLTextAreaElement | null | undefined, value: string) => {
  if (!field) throw new Error("Expected the field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const field = (label: string) => {
  const id = [...sheet().querySelectorAll("label")].find((candidate) => candidate.textContent === label)?.getAttribute("for");
  return id === null || id === undefined ? undefined : document.getElementById(id) as HTMLTextAreaElement | null;
};

type StartProps = ComponentProps<typeof WorkflowStartView>;
function proposal(props: Partial<StartProps> = {}) {
  const handlers = { onRetry: vi.fn(), onStart: vi.fn(), onChanges: vi.fn(() => Promise.resolve(true)), onDismiss: vi.fn(), onClose: vi.fn() };
  return { handlers, element: <WorkflowSheet mode="start" source={{ kind: "proposal", entry: RICH_ENTRY, proposal: RICH_PROPOSAL }} models={WORKER_MODELS}
    agents={AGENTS} {...handlers} {...props} /> };
}

describe("a saved workflow's sheet", () => {
  it("shows the file's prose as the plan, the route with a model per worker, the inputs, and starts with them", async () => {
    const onStart = vi.fn();
    const onBack = vi.fn();
    await act(async () => root.render(<WorkflowSheet mode="start" source={{ kind: "saved", workflow: SAVED_RICH, initialTask: "Port it." }} models={WORKER_MODELS}
      onStart={onStart} onBack={onBack} onClose={() => {}} />));
    expect(sheet().querySelector(".split-sheet-title")?.textContent).toBe("Port settings to the shared store");
    expect(sheet().querySelector(".split-sheet-subtitle")?.textContent).toBe("settings-store-portSaved workflow, 4 stages");
    expect(headings()).toEqual(["1Shape", "2Port the API and the page", "3Review", "4Land"]);
    // The plan uses the chat's blocks.
    expect(pane("Plan")?.querySelector(".callout")).not.toBeNull();
    expect([...sheet().querySelectorAll(".route-list-who-line code")].map((node) => node.textContent)).toEqual(["api", "page", "review"]);
    expect([...sheet().querySelectorAll(".model-trigger-name")].map((node) => node.textContent)).toEqual(["Claude Sonnet 5", "Session's model", "Session's model"]);
    // Saved files are not edited here.
    expect(button("Edit stages")).toBeUndefined();
    expect(field("Task")?.value).toBe("Port it.");
    await press("Start workflow");
    expect(onStart).toHaveBeenCalledWith({ task: "Port it.", base: "main" }, undefined);
    await press("All workflows");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("asks for a missing input, holds Start with a reason, and says why a start failed", async () => {
    const onStart = vi.fn();
    const render = (props: { blocked?: string; error?: string }) => <WorkflowSheet mode="start" source={{ kind: "saved", workflow: SAVED_RICH }} models={WORKER_MODELS}
      onStart={onStart} onClose={() => {}} {...props} />;
    await act(async () => root.render(render({})));
    await press("Start workflow");
    expect(onStart).not.toHaveBeenCalled();
    expect(problem()).toBe("Fill in task.");
    await act(async () => root.render(render({ blocked: "Finish the running workflow before you start another." })));
    expect(button("Start workflow")?.disabled).toBe(true);
    expect(note()).toBe("Finish the running workflow before you start another.");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(render({ error: START_REFUSED })));
    expect(problem()).toBe(START_REFUSED);
  });
});

describe("a proposal's sheet", () => {
  it("steps a number, marks only changed inputs, and restores the agent's value before starting", async () => {
    const { element, handlers } = proposal();
    await act(async () => root.render(element));
    const number = sheet().querySelector<HTMLInputElement>('input[type="number"]');
    expect(number?.value).toBe("2");
    await press("Increase Review rounds before the run stops and reports");
    expect(number?.value).toBe("3");
    expect(sheet().querySelector(".field-edit-note")?.textContent).toContain("Edited");
    await press("Use the agent's");
    expect(number?.value).toBe("2");
    expect(sheet().querySelector(".field-edit-note")).toBeNull();
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ rounds: 2 }), undefined);
  });
  it("splits the plan into one numbered section per stage, beside the route", async () => {
    await act(async () => root.render(proposal().element));
    expect(headings()).toEqual(["1Shape", "2Port the API and the page", "3Review", "4Land"]);
    expect(sheet().querySelector(".numbered-sections-overview")?.textContent).toContain("The settings page fetches each setting on its own.");
    expect([...sheet().querySelectorAll(".route-list-name")].map((node) => node.textContent)).toEqual(["Shape", "Port the API and the page", "Review", "Land"]);
    expect(note()).toBe("It runs in this chat. Nothing is saved to the repository.");
    expect(button("Start workflow")?.getAttribute("data-tone")).toBe("primary");
  });

  it("starts with the models the reader changed, and keeps Start for a model-only change", async () => {
    const { element, handlers } = proposal({ initial: { route: setWorkerModel(PROPOSAL_STAGES, "api", "anthropic/claude-opus-4-5:high") } });
    await act(async () => root.render(element));
    expect(note()).toBe("1 model changed. The run uses it; the plan stays as it is.");
    expect(sheet().querySelector(".route-list-control[data-edited] .model-trigger-name")?.textContent).toBe("Claude Opus 4.5");
    expect(button("Update the plan")).toBeUndefined();
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenCalledWith({ task: RICH_PROPOSAL.inputs["task"], rounds: 2 }, { api: "anthropic/claude-opus-4-5:high" });
    // The way back to the agent's model.
    await press("Use the agent's");
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenLastCalledWith({ task: RICH_PROPOSAL.inputs["task"], rounds: 2 }, undefined);
  });

  it("edits stages and workers, and then sends the changes as a note in place of Start", async () => {
    const { element, handlers } = proposal();
    await act(async () => root.render(element));
    await press("Edit stages");
    await press("Remove worker page");
    await press("Remove stage Shape");
    expect(note()).toBe("You changed the route. Update the plan, then start the new one.");
    expect(button("Start workflow")?.disabled).toBe(true);
    // The plan says what no longer matches, and the route can take each change back.
    expect(sheet().querySelector(".rule-block")?.getAttribute("aria-label")).toBe("The plan does not match your route yet");
    expect([...sheet().querySelectorAll(".rule-block-text")].map((node) => node.textContent)).toEqual(["Removed stage Shape.", "Removed worker page from Port the API and the page."]);
    expect(sheet().querySelector(".numbered-sections-section[data-change='removed']")?.textContent).toContain("You removed this stage.");
    await press("Update the plan");
    const box = sheet().querySelector<HTMLTextAreaElement>("textarea[aria-label='What should change in this workflow?']");
    expect(box?.value).toBe("Change the route:\n- Removed stage Shape.\n- Removed worker `page` from Port the API and the page.");
    await type(box, `${box!.value}\nKeep one reviewer.`);
    await press("Update the plan");
    expect(handlers.onChanges).toHaveBeenCalledWith("Change the route:\n- Removed stage Shape.\n- Removed worker `page` from Port the API and the page.\nKeep one reviewer.");
    await press("Back");
    await press("Undo all");
    expect(button("Start workflow")?.disabled).toBe(false);
    expect(sheet().querySelector(".rule-block")).toBeNull();
  });

  it("adds a stage where the reader asks, with a section the agent will write", async () => {
    await act(async () => root.render(proposal({ initial: { editing: true } }).element));
    const gaps = [...sheet().querySelectorAll(".route-list-gap button")];
    // Before each stage and after each, but never after the land stop.
    expect(gaps).toHaveLength(4);
    await act(async () => { (gaps[3] as HTMLButtonElement).click(); });
    const input = sheet().querySelector<HTMLInputElement>(".text-submit-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Docs");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.form?.requestSubmit(); });
    expect([...sheet().querySelectorAll(".route-list-name")].map((node) => node.textContent)).toEqual(["Shape", "Port the API and the page", "Review", "Docs", "Land"]);
    expect(sheet().querySelector(".numbered-sections-section[data-change='added']")?.textContent).toContain("The agent writes this section when it updates the plan.");
  });

  it("asks for changes only with a note", async () => {
    const { element, handlers } = proposal();
    await act(async () => root.render(element));
    await press("Ask for changes");
    expect(button("Send changes")?.disabled).toBe(true);
    await type(sheet().querySelector<HTMLTextAreaElement>("textarea[aria-label='What should change in this workflow?']"), "Split the review.");
    await press("Send changes");
    expect(handlers.onChanges).toHaveBeenCalledWith("Split the review.");
  });

  it("shows what the card knows while reading, and Retry when the read failed", async () => {
    await act(async () => root.render(proposal({ source: { kind: "proposal", entry: RICH_ENTRY } }).element));
    expect(note()).toBe("Reading the proposal…");
    expect(text()).toContain(RICH_ENTRY.summary);
    expect(sheet().querySelector(".loading-lines")).not.toBeNull();
    expect(pane("Plan")?.getAttribute("aria-busy")).toBe("true");
    expect(button("Start workflow")?.disabled).toBe(true);
    expect([...sheet().querySelectorAll(".route-list-name")].map((node) => node.textContent)).toContain("Review");
    const { element, handlers } = proposal({ source: { kind: "proposal", entry: RICH_ENTRY, readError: READ_FAILED } });
    await act(async () => root.render(element));
    expect(pane("The proposal could not be read")?.textContent).toContain(READ_FAILED);
    expect(note()).toBe("Read the proposal again to start it.");
    await press("Retry");
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it("holds Start while blocked, every action while one is on its way, and says why a start failed", async () => {
    await act(async () => root.render(proposal({ blocked: "Wait for the agent to finish its turn." }).element));
    expect(button("Start workflow")?.disabled).toBe(true);
    expect(button("Dismiss")?.disabled).toBe(false);
    expect(note()).toBe("Wait for the agent to finish its turn.");
    await act(async () => root.render(proposal({ pending: "start" }).element));
    expect(note()).toBe("Starting…");
    expect(["Dismiss", "Ask for changes", "Start workflow"].map((name) => button(name)?.disabled)).toEqual([true, true, true]);
    expect(sheet().querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => root.render(proposal({ error: START_REFUSED }).element));
    expect(problem()).toBe(START_REFUSED);
    expect(button("Start workflow")?.disabled).toBe(false);
  });

  it("goes quiet once decided: one line, no actions", async () => {
    const { element, handlers } = proposal({ source: { kind: "proposal", entry: RICH_ENTRY, proposal: { ...REPLACED_PROPOSAL, text: RICH_PROPOSAL.text } } });
    await act(async () => root.render(element));
    expect(note()).toBe("Replaced by a newer proposal");
    expect(button("Start workflow")).toBeUndefined();
    expect(button("Dismiss")).toBeUndefined();
    expect(button("Edit stages")).toBeUndefined();
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it("shows a prose-only proposal as one page, with an empty route that can take a first stage", async () => {
    const prose = { kind: "proposal" as const, entry: { ...RICH_ENTRY, proposalId: PROSE.id, name: PROSE.name, stages: [] }, proposal: PROSE };
    const { element, handlers } = proposal({ source: prose });
    await act(async () => root.render(element));
    expect(headings()).toEqual([]);
    expect(pane("Plan")?.textContent).toContain("Split the suites between three researchers.");
    expect(sheet().querySelector(".split-sheet-subtitle")?.textContent).toBe("Proposed workflow");
    expect(sheet().querySelector(".route-list-empty")?.textContent).toBe("No stages. The agent follows the plan's prose. Edit stages to give it a route.");
    expect(button("Start workflow")?.disabled).toBe(false);
    await press("Edit stages");
    expect(sheet().querySelector(".route-list-empty")?.textContent).toBe("No stages yet. Add the first one.");
    await press("Add a stage");
    const input = sheet().querySelector<HTMLInputElement>(".text-submit-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Split the suites");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.form?.requestSubmit(); });
    expect([...sheet().querySelectorAll(".route-list-name")].map((node) => node.textContent)).toEqual(["Split the suites"]);
    expect(sheet().querySelector(".numbered-sections-section[data-change='added']")?.textContent).toContain("The agent writes this section when it updates the plan.");
    expect(button("Start workflow")?.disabled).toBe(true);
    await press("Update the plan");
    await press("Update the plan");
    expect(handlers.onChanges).toHaveBeenCalledWith("Change the route:\n- New stage Split the suites, first.");
  });

  it("shows no route for a decided prose-only proposal or a saved prose-only file", async () => {
    await act(async () => root.render(proposal({ source: { kind: "proposal", entry: { ...RICH_ENTRY, proposalId: PROSE.id, name: PROSE.name, stages: [] },
      proposal: { ...PROSE, state: { kind: "dismissed", decidedAt: 1 } } } }).element));
    expect(sheet().querySelector(".route-list")).toBeNull();
    await act(async () => root.render(<WorkflowSheet mode="start" source={{ kind: "saved", workflow: { ...SAVED_RICH, definition: { version: 1 }, text: PROSE.text, body: PROSE.text } }}
      models={WORKER_MODELS} onStart={() => {}} onClose={() => {}} />));
    expect(sheet().querySelector(".route-list")).toBeNull();
  });
});

type RunProps = ComponentProps<typeof WorkflowRunView>;
function running(props: Partial<RunProps> = {}) {
  const handlers = { onDecide: vi.fn(() => Promise.resolve(true)), onOpenWorker: vi.fn(), onRetryRecord: vi.fn(), onSteer: vi.fn(() => Promise.resolve()),
    onStopRun: vi.fn(() => Promise.resolve(true)), onStopWorker: vi.fn(), onDismissRecordError: vi.fn(), onModel: vi.fn(() => Promise.resolve(true)), onClose: vi.fn() };
  return { handlers, element: <WorkflowSheet mode="run" run={RUN_WORKING} looks={LOOKS} models={WORKER_MODELS} now={() => SHEET_NOW} {...handlers} {...props} /> };
}
const worker = (name: string) => [...sheet().querySelectorAll<HTMLButtonElement>("button.route-list-worker")].find((node) => node.querySelector("code")?.textContent === name);

describe("a run's sheet", () => {
  it("confirms whole-run cancellation, permits backing out, and holds the action while stopping", async () => {
    const { element, handlers } = running();
    await act(async () => root.render(element));
    await press("Stop the run");
    expect(note()).toContain("Files and commits stay");
    expect(handlers.onStopRun).not.toHaveBeenCalled();
    await press("Keep running");
    expect(button("Stop now")).toBeUndefined();
    await press("Stop the run");
    await press("Stop now");
    expect(handlers.onStopRun).toHaveBeenCalledOnce();
    const stopping = running({ run: { ...RUN_WORKING, state: { kind: "stopping" } } });
    await act(async () => root.render(stopping.element));
    expect(button("Stopping…")?.disabled).toBe(true);
    expect(button("Stop the run")).toBeUndefined();
  });
  it("marks the stage at work in the plan, and lists each worker with its blocks, where it stands, and its model", async () => {
    await act(async () => root.render(running().element));
    expect(sheet().querySelector(".split-sheet-subtitle")?.textContent).toBe("settings-store-portPort the API and the page, 1 working");
    expect([...sheet().querySelectorAll(".numbered-sections-section")].map((node) => node.getAttribute("data-mark"))).toEqual(["done", "current", null, null]);
    expect([...sheet().querySelectorAll(".numbered-sections-said")].map((node) => node.textContent)).toEqual(["Step 1, done: ", "Step 2, at work: ", "Step 3: ", "Step 4: "]);
    expect(worker("api")?.textContent).toBe("apifull-stack-engineerWorkingClaude Sonnet 5");
    expect(worker("page")?.textContent).toBe("pagedesign-engineerDoneSession's model");
    expect(sheet().querySelector(".route-list-meta")?.textContent).toBe("1 of 4 done");
    expect(note()).toBe("Started 23 min ago. The next stop for you is Land.");
  });

  it("puts a waiting stop on top as the chat's decision card", async () => {
    const { element, handlers } = running({ run: RUN_AT_STOP });
    await act(async () => root.render(element));
    const card = sheet().querySelector(".split-sheet-lead .decision-card");
    expect(card?.textContent).toContain("The shape is in");
    await press("Approve");
    expect(handlers.onDecide).toHaveBeenCalledWith("shape", "approve", undefined);
  });

  it("opens a worker's live record with Stop, its model from its next turn, and a box to steer it", async () => {
    const { element, handlers } = running({ record: { transcript: API_TRANSCRIPT } });
    await act(async () => root.render(element));
    await act(async () => { worker("api")!.click(); });
    expect(handlers.onOpenWorker).toHaveBeenLastCalledWith(41);
    expect(pane("api's record")?.textContent).toContain("The shape lists 14 settings.");
    expect(worker("api")?.getAttribute("aria-current")).toBe("true");
    expect(sheet().querySelector(".detail-pane-bar")?.textContent).toContain("From its next turn. The turn in progress finishes on its current model.");
    await press("Stop");
    expect(handlers.onStopWorker).toHaveBeenCalledWith(41);
    await type(sheet().querySelector<HTMLTextAreaElement>("textarea[aria-label='Message api']"), "Keep GET /settings/:key.");
    await press("Send to api");
    expect(handlers.onSteer).toHaveBeenCalledWith(41, "Keep GET /settings/:key.");
    await press("Plan");
    expect(handlers.onOpenWorker).toHaveBeenLastCalledWith(undefined);
    expect(headings()).toHaveLength(4);
  });

  it("offers Stop for a settled worker that took a follow-up message", async () => {
    const { element, handlers } = running({ initialWorker: "port/page", record: { transcript: API_TRANSCRIPT },
      looks: [LOOKS[0]!, { ...LOOKS[1]!, busy: true, conversationId: 42 }] });
    await act(async () => root.render(element));
    expect(sheet().querySelector(".detail-pane-status")?.textContent).toBe("Working on a follow-up");
    expect(sheet().querySelector<HTMLTextAreaElement>("textarea[aria-label='Message page']")?.placeholder).toBe("Steer page while it works");
    await press("Stop");
    expect(handlers.onStopWorker).toHaveBeenCalledWith(42);
  });

  it("changes a worker's model on the run, and back to the session's", async () => {
    const { element, handlers } = running({ run: { ...RUN_WORKING, stages: setWorkerModel(PROPOSAL_STAGES, "page", "openai/gpt-5") }, initialWorker: "port/page" });
    await act(async () => root.render(element));
    expect(sheet().querySelector(".detail-pane-bar")?.textContent).toContain("From its next turn.");
    await press("Use the session's model");
    expect(handlers.onModel).toHaveBeenCalledWith("page", null);
  });

  it("says where a worker's record will be before it starts, and offers no box to steer it", async () => {
    await act(async () => root.render(running({ initialWorker: "review/review" }).element));
    expect(pane("review's record")?.textContent).toBe("This worker has not started. Its record shows here when it does.");
    expect(sheet().querySelector("textarea")).toBeNull();
    expect(sheet().querySelector(".detail-pane-bar")?.textContent).toContain("It starts on this model.");
    expect(button("Stop")).toBeUndefined();
  });

  it("reads a worker's record, and offers Retry when the read failed", async () => {
    await act(async () => root.render(running({ initialWorker: "port/page", record: {} }).element));
    expect(pane("page's record")?.textContent).toBe("Reading the record…");
    const { element, handlers } = running({ initialWorker: "port/page", record: { readError: READ_FAILED } });
    await act(async () => root.render(element));
    expect(pane("page's record could not be read")?.textContent).toContain(READ_FAILED);
    await press("Retry");
    expect(handlers.onRetryRecord).toHaveBeenCalledWith(42);
  });

  it("lists the workers of a run without stages", async () => {
    await act(async () => root.render(running({ run: PROSE_RUN, looks: [] }).element));
    expect(sheet().querySelector(".route-list")?.getAttribute("aria-label")).toBe("Workers");
    expect([...sheet().querySelectorAll(".route-list-who-line code")].map((node) => node.textContent)).toEqual(["store-hunt", "reconnect-hunt"]);
    expect(pane("Plan")?.textContent).toContain("Split the suites between three researchers.");
  });

  it("puts the result on top once the run finishes", async () => {
    await act(async () => root.render(running({ run: RUN_FINISHED }).element));
    const lead = sheet().querySelector(".split-sheet-lead .rule-block");
    expect(lead?.getAttribute("aria-label")).toBe("Finished");
    expect(lead?.textContent).toContain("The settings page reads from the shared store");
    expect(note()).toBe("Finished. Ran for 58 min.");
    // A finished run folds its workers into blocks; opened, a worker's model no longer changes.
    expect(worker("api")).toBeUndefined();
    await press("Port the API and the page");
    await act(async () => { worker("api")?.click(); });
    expect(sheet().querySelector(".detail-pane-bar .model-trigger")?.hasAttribute("disabled")).toBe(true);
  });
});
