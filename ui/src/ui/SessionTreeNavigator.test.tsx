// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTreeNavigator, type SessionTreeBinding } from "./SessionTreeNavigator";
import type { SessionTreeSnapshot, TreeOperation } from "../sessionTree";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

/** u1 → a1 → u2 → a2 (active), with an abandoned side branch u1 → a1 → side. */
const tree: SessionTreeSnapshot = {
  nodes: [
    { id: "u1", parentId: null, kind: "user", summary: "Plan the login fix", timestamp: "2026-10-05T10:00:00.000Z" },
    { id: "a1", parentId: "u1", kind: "assistant", summary: "Here is a plan" },
    { id: "side", parentId: "a1", kind: "user", summary: "Try sessions instead", label: "alt" },
    { id: "u2", parentId: "a1", kind: "user", summary: "Write the tests" },
    { id: "a2", parentId: "u2", kind: "assistant", summary: "Tests written" },
  ],
  activeLeafId: "a2", activePathIds: ["u1", "a1", "u2", "a2"],
};
function binding(overrides: Partial<SessionTreeBinding> = {}): SessionTreeBinding {
  return { tree, operation: { type: "idle" }, onContinue: vi.fn(), onFork: vi.fn(), onAbort: vi.fn(), onClose: vi.fn(), ...overrides };
}
const render = (props: SessionTreeBinding) => act(async () => root.render(<SessionTreeNavigator {...props} />));
const dialog = () => document.querySelector<HTMLDialogElement>("dialog.tree-dialog")!;
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const summaries = () => rows().map((row) => row.querySelector(".tree-summary")?.textContent);
const selected = () => document.querySelector('[role="treeitem"][aria-selected="true"] .tree-summary')?.textContent;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name)!;
const click = (node: HTMLElement) => act(async () => node.click());
const key = (name: string, target: HTMLElement = document.querySelector('[role="tree"]')!) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});
const escape = () => act(async () => { dialog().dispatchEvent(new Event("cancel", { cancelable: true })); });

describe("session tree navigator", () => {
  it("opens as a named modal on your messages, with the latest one you sent selected and focused", async () => {
    await render(binding());
    expect(dialog().getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toBe("Session tree");
    expect(summaries()).toEqual(["Plan the login fix", "Write the tests", "Try sessions instead"]);
    // The active leaf is an assistant reply, hidden by this lens. Its nearest user ancestor stands in.
    expect(selected()).toBe("Write the tests");
    expect(document.activeElement?.querySelector(".tree-summary")?.textContent).toBe("Write the tests");
  });

  it("moves with the arrow keys and continues from the selection with Enter", async () => {
    const props = binding();
    await render(props);
    await key("ArrowUp");
    expect(selected()).toBe("Plan the login fix");
    await key("Enter");
    expect(props.onContinue).toHaveBeenCalledWith("u1", { mode: "none" });
  });

  it("asks for a summary of the branch it leaves, with an optional focus", async () => {
    const props = binding();
    await render(props);
    await click(button("Summarize"));
    expect(button("Summarize").getAttribute("aria-pressed")).toBe("true");
    const focus = document.querySelector<HTMLInputElement>('input[aria-label="Summary focus (optional)"]')!;
    expect(document.activeElement).toBe(focus);
    await click(button("Continue from here"));
    expect(props.onContinue).toHaveBeenLastCalledWith("u2", { mode: "default" });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(focus, "  keep the API notes ");
      focus.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Continue from here"));
    expect(props.onContinue).toHaveBeenLastCalledWith("u2", { mode: "custom", instructions: "keep the API notes" });
  });

  it("forks from the selected entry", async () => {
    const props = binding();
    await render(props);
    await click(rows().find((row) => row.textContent?.includes("Try sessions instead"))!);
    await click(button("Fork"));
    expect(props.onFork).toHaveBeenCalledWith("side");
  });

  it("widens and narrows the view without losing the entry you meant", async () => {
    await render(binding());
    await click(button("All"));
    expect(summaries()).toEqual(["Plan the login fix", "Here is a plan", "Write the tests", "Tests written", "Try sessions instead"]);
    await click(rows().find((row) => row.textContent?.includes("Tests written"))!);
    await click(button("User"));
    expect(selected()).toBe("Write the tests");
    await click(button("All"));
    expect(selected()).toBe("Tests written");
  });

  it("searches every entry and says when nothing matches", async () => {
    await render(binding());
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const typeSearch = (text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await typeSearch("TESTS");
    expect(summaries()).toEqual(["Write the tests"]);
    await typeSearch("nothing like this");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".tree-empty")?.textContent).toBe("No entries match this search.");
  });

  it("marks the current entry and fades the entries a new position would leave", async () => {
    await render(binding());
    await click(button("All"));
    expect(rows().find((row) => row.getAttribute("aria-current") === "true")?.textContent).toContain("Current");
    await click(rows().find((row) => row.textContent?.includes("Here is a plan"))!);
    const leaving = rows().filter((row) => row.dataset.leaving !== undefined).map((row) => row.querySelector(".tree-summary")?.textContent);
    expect(leaving).toEqual(["Write the tests", "Tests written"]);
  });

  it("folds a fork from its caret and from the keyboard", async () => {
    await render(binding());
    await click(button("All"));
    const fork = () => rows().find((row) => row.textContent?.includes("Here is a plan"))!;
    expect(fork().getAttribute("aria-expanded")).toBe("true");
    await click(fork().querySelector<HTMLElement>(".tree-fold")!);
    expect(summaries()).toEqual(["Plan the login fix", "Here is a plan"]);
    await key("ArrowRight");
    expect(summaries()).toHaveLength(5);
  });

  it("closes with Escape and the close button only while idle", async () => {
    const props = binding();
    await render(props);
    await escape();
    await click(button("Close session tree"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("locks the actions while one runs, and lets Escape stop only a running summary", async () => {
    const forking = binding({ operation: { type: "forking" } });
    await render(forking);
    expect(button("Forking…").disabled).toBe(true);
    expect(button("Continue from here").disabled).toBe(true);
    expect(button("Close session tree").disabled).toBe(true);
    await escape();
    expect(forking.onClose).not.toHaveBeenCalled();
    expect(forking.onAbort).not.toHaveBeenCalled();

    const summarizing = binding({ operation: { type: "continuing", summarizing: true, aborting: false } });
    await render(summarizing);
    expect(button("Summarizing…").disabled).toBe(true);
    await escape();
    expect(summarizing.onAbort).toHaveBeenCalledOnce();
    await click(button("Stop summary"));
    expect(summarizing.onAbort).toHaveBeenCalledTimes(2);
    await render({ ...summarizing, operation: { type: "continuing", summarizing: true, aborting: true } });
    expect(button("Stopping…").disabled).toBe(true);
  });

  it("reopens a dialog the browser closes while an action runs, and closes the store's copy when idle", async () => {
    const busy = binding({ operation: { type: "forking" } });
    await render(busy);
    const showModal = vi.spyOn(dialog(), "showModal");
    await act(async () => { dialog().dispatchEvent(new Event("close")); });
    expect(showModal).toHaveBeenCalledOnce();
    expect(busy.onClose).not.toHaveBeenCalled();
    const idle = binding();
    await render(idle);
    await act(async () => { dialog().dispatchEvent(new Event("close")); });
    expect(idle.onClose).toHaveBeenCalledOnce();
  });

  it("closes from the backdrop only for a press that starts there, and never stops a summary", async () => {
    const press = (down: Element) => act(async () => {
      down.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const idle = binding();
    await render(idle);
    await press(document.querySelector('input[type="search"]')!);
    expect(idle.onClose).not.toHaveBeenCalled();
    await press(dialog());
    expect(idle.onClose).toHaveBeenCalledOnce();
    const summarizing = binding({ operation: { type: "continuing", summarizing: true, aborting: false } });
    await render(summarizing);
    await press(dialog());
    expect(summarizing.onClose).not.toHaveBeenCalled();
    expect(summarizing.onAbort).not.toHaveBeenCalled();
  });

  it("nests entries by fork, not by every linear step", async () => {
    await render(binding());
    await click(button("All"));
    const level = (summary: string) => rows().find((row) => row.textContent?.includes(summary))!;
    expect(["Plan the login fix", "Here is a plan", "Write the tests", "Tests written", "Try sessions instead"]
      .map((summary) => level(summary).getAttribute("aria-level"))).toEqual(["1", "1", "2", "2", "2"]);
    expect(rows().filter((row) => row.hasAttribute("aria-expanded")).map((row) => row.querySelector(".tree-summary")?.textContent))
      .toEqual(["Here is a plan"]);
    // Left on a linear entry steps back instead of folding the rest away.
    await click(level("Tests written"));
    await key("ArrowLeft");
    expect(selected()).toBe("Write the tests");
    expect(rows()).toHaveLength(5);
  });

  it("leaves modified keys to the browser", async () => {
    await render(binding());
    await act(async () => {
      document.querySelector('[role="tree"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(selected()).toBe("Write the tests");
  });

  it("puts focus back on the selected entry when an action ends", async () => {
    await render(binding({ operation: { type: "forking" } }));
    (document.activeElement as HTMLElement | null)?.blur();
    await render(binding({ operation: { type: "idle", notice: { tone: "status", message: "Fork cancelled. No new session was created." } } }));
    expect(document.activeElement?.querySelector(".tree-summary")?.textContent).toBe("Write the tests");
  });

  it("shows the outcome of the last action", async () => {
    const notice = (operation: TreeOperation) => render(binding({ operation }));
    await notice({ type: "idle", notice: { tone: "error", message: "The session changed since /tree was opened." } });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The session changed since /tree was opened.");
    await notice({ type: "idle", notice: { tone: "status", message: "Fork cancelled. No new session was created." } });
    expect(document.querySelector('.tree-notice[role="status"]')?.textContent).toBe("Fork cancelled. No new session was created.");
  });
});
