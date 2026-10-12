// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowProposalSheet } from "./WorkflowProposalSheet";
import { PROPOSAL, PROPOSAL_ENTRY, READ_FAILED, REPLACED_PROPOSAL, START_REFUSED } from "./fixtures/proposals";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name);
const press = async (name: string) => { await act(async () => { button(name)?.click(); }); };
const text = () => document.body.textContent ?? "";
const note = () => document.querySelector(".action-footer-note")?.textContent ?? "";
const type = async (field: HTMLTextAreaElement | null | undefined, value: string) => {
  if (!field) throw new Error("Expected the field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const fieldLabelled = (label: string) => {
  const id = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent === label)?.getAttribute("for");
  return id === null || id === undefined ? undefined : document.getElementById(id) as HTMLTextAreaElement | null;
};

function sheet(props: Partial<ComponentProps<typeof WorkflowProposalSheet>> = {}) {
  const handlers = { onRetry: vi.fn(), onStart: vi.fn(), onChanges: vi.fn(() => Promise.resolve(true)), onDismiss: vi.fn(), onClose: vi.fn() };
  return { handlers, element: <WorkflowProposalSheet entry={PROPOSAL_ENTRY} proposal={PROPOSAL} {...handlers} {...props} /> };
}

describe("a proposed workflow's sheet", () => {
  it("shows the overview, the agent's inputs with the task first, the route, and the instructions closed", async () => {
    await act(async () => root.render(sheet().element));
    expect(text()).toContain(PROPOSAL.summary);
    expect([...document.querySelectorAll("label")].map((label) => label.textContent)).toEqual(["Task", "rounds"]);
    expect(fieldLabelled("Task")?.value).toBe(PROPOSAL.inputs["task"]);
    expect(fieldLabelled("rounds")?.value).toBe("2");
    expect(document.querySelector(".toggle-group-field")?.textContent).toBe("Branch to land onmainnext");
    expect(document.querySelector("[aria-label='What happens']")?.textContent).toContain("Port the API and the page");
    expect(text()).toContain("full-stack-engineer");
    const instructions = document.querySelector("details");
    expect(instructions?.open).toBe(false);
    expect(instructions?.textContent).toContain("Full instructions");
    expect(instructions?.textContent).not.toContain("description:");
  });

  it("starts with the inputs as the reader edited them", async () => {
    const { element, handlers } = sheet();
    await act(async () => root.render(element));
    await type(fieldLabelled("Task"), "Port only the API.");
    await type(fieldLabelled("rounds"), "3");
    await press("next");
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenCalledWith({ task: "Port only the API.", base: "next", rounds: 3 });
  });

  it("asks for an input with no value and no default before it starts", async () => {
    const { element, handlers } = sheet({ proposal: { ...PROPOSAL, inputs: {} } });
    await act(async () => root.render(element));
    await press("Start workflow");
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(note()).toBe("Fill in task.");
  });

  it("sends an empty string the agent filled, though the input has no default", async () => {
    const { element, handlers } = sheet({ proposal: { ...PROPOSAL, definition: { version: 1, inputs: { suffix: { type: "string" } } }, inputs: { suffix: "" } } });
    await act(async () => root.render(element));
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenCalledWith({ suffix: "" });
  });

  it("sends an input the reader cleared as empty, not as its default", async () => {
    const proposal = { ...PROPOSAL, definition: { version: 1 as const, inputs: { task: { type: "string" as const }, suffix: { type: "string" as const, default: ".ts" } } },
      inputs: { task: "Rename the files." } };
    const { element, handlers } = sheet({ proposal });
    await act(async () => root.render(element));
    // Untouched, the default is left to the server.
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenLastCalledWith({ task: "Rename the files." });
    expect(fieldLabelled("suffix")?.value).toBe(".ts");
    await type(fieldLabelled("suffix"), "");
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenLastCalledWith({ task: "Rename the files.", suffix: "" });
    // A task the reader cleared is sent as it stands too.
    await type(fieldLabelled("Task"), "");
    await press("Start workflow");
    expect(handlers.onStart).toHaveBeenLastCalledWith({ task: "", suffix: "" });
  });

  it("asks for changes only with a note", async () => {
    const { element, handlers } = sheet();
    await act(async () => root.render(element));
    await press("Ask for changes");
    expect(button("Start workflow")).toBeUndefined();
    expect((button("Send changes") as HTMLButtonElement).disabled).toBe(true);
    await type(document.querySelector<HTMLTextAreaElement>("textarea[aria-label='What should change in this workflow?']"), "Split the review.");
    await press("Send changes");
    expect(handlers.onChanges).toHaveBeenCalledWith("Split the review.");
    await press("Back");
    expect(button("Start workflow")).toBeDefined();
  });

  it("dismisses", async () => {
    const { element, handlers } = sheet();
    await act(async () => root.render(element));
    await press("Dismiss");
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it.each(["Another workflow is running.", "Wait for the agent to finish its turn."])("holds Start with the reason: %s", async (reason) => {
    await act(async () => root.render(sheet({ blocked: reason }).element));
    expect((button("Start workflow") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Dismiss") as HTMLButtonElement).disabled).toBe(false);
    expect(note()).toBe(reason);
  });

  it("reads the proposal before it can start", async () => {
    await act(async () => root.render(sheet({ proposal: undefined }).element));
    expect(note()).toBe("Reading the proposal…");
    expect((button("Start workflow") as HTMLButtonElement).disabled).toBe(true);
    // What the card knew shows at once.
    expect(document.querySelector("[aria-label='What happens']")?.textContent).toContain("Review");
  });

  it("shows a failed read with Retry", async () => {
    const { element, handlers } = sheet({ proposal: undefined, readError: READ_FAILED });
    await act(async () => root.render(element));
    expect(document.querySelector("[aria-label='The proposal could not be read']")?.textContent).toContain(READ_FAILED);
    await press("Retry");
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it("says why an action failed in the footer, and stays open", async () => {
    await act(async () => root.render(sheet({ error: START_REFUSED }).element));
    expect(document.querySelector(".action-footer-note [role='alert']")?.textContent).toBe(START_REFUSED);
    expect((button("Start workflow") as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds every action while one is on its way, and once the proposal closed elsewhere", async () => {
    await act(async () => root.render(sheet({ pending: "start" }).element));
    expect(note()).toBe("Starting…");
    expect(["Dismiss", "Ask for changes", "Start workflow"].map((name) => (button(name) as HTMLButtonElement).disabled)).toEqual([true, true, true]);
    await act(async () => root.render(sheet({ proposal: REPLACED_PROPOSAL }).element));
    expect(note()).toBe("Replaced by a newer proposal");
    expect(["Dismiss", "Ask for changes", "Start workflow"].map((name) => (button(name) as HTMLButtonElement).disabled)).toEqual([true, true, true]);
  });
});
