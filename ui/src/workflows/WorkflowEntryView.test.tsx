// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowEntryView } from "./WorkflowEntryView";
import { BUILDING, CONTRACT_STOP, CONTRACT_WAITING, LAND_STOP, LAND_WAITING } from "./fixtures/runs";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name);
const press = async (name: string) => { await act(async () => { button(name)?.click(); }); };

describe("a workflow stop in the thread", () => {
  it("approves, and asks for changes with the reader's words", async () => {
    const onDecide = vi.fn(() => Promise.resolve(true));
    await act(async () => root.render(<WorkflowEntryView entry={CONTRACT_STOP} run={CONTRACT_WAITING} onDecide={onDecide} />));
    expect(document.body.textContent).toContain("docs/contracts/run-export.md");
    await press("Approve");
    expect(onDecide).toHaveBeenLastCalledWith("approve");
    await press("Ask for changes");
    const box = document.querySelector("textarea");
    if (box === null) throw new Error("Expected the changes box");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "Name the columns.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Send changes");
    expect(onDecide).toHaveBeenLastCalledWith("changes", "Name the columns.");
  });

  it("lands every branch from the land stop, and offers the branches to review first", async () => {
    const onDecide = vi.fn(() => Promise.resolve(true));
    const onReview = vi.fn();
    await act(async () => root.render(<WorkflowEntryView entry={LAND_STOP} run={LAND_WAITING} onDecide={onDecide} onReview={onReview} />));
    await press("Review branches");
    expect(onReview).toHaveBeenCalled();
    await press("Land all");
    expect(onDecide).toHaveBeenLastCalledWith("land");
  });

  it("closes once decided, and offers no choices where the reader cannot decide", async () => {
    await act(async () => root.render(<WorkflowEntryView entry={CONTRACT_STOP} run={BUILDING} onDecide={() => Promise.resolve(true)} />));
    expect(button("Approve")).toBeUndefined();
    expect(document.body.textContent).toContain("Approved by you.");
    await act(async () => root.render(<WorkflowEntryView entry={CONTRACT_STOP} run={CONTRACT_WAITING} />));
    expect(button("Approve")).toBeUndefined();
    expect(document.body.textContent).toContain("Waiting for a decision.");
  });
});
