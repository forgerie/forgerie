// @vitest-environment happy-dom

import type { TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTreeForkResult, SessionTreeNavigateResult, SessionTreeNodeKind, SessionTreeSnapshot, SessionTreeSummaryChoice } from "../api";
import type { SessionTreeFilterMode } from "../sessionTreeModel";
// The modal-surface shell (focus on open, Escape/backdrop routing) is exercised
// through real DOM interaction; keyboard state and hierarchy stay covered through
// the pure sessionTreeModel, and TemplateResult extraction is limited to pointer
// row/footer wiring in the method-level interaction tests.
import { templateClickHandlerForText, templateEventHandlerNearMarker } from "../templateInspection.testSupport";
import { deepActiveElement, dialogSurface, pressKey, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import { SessionTreeNavigator, sessionTreeEntryReturnsToEditor, sessionTreeKindPresentation, sessionTreeVisualDepth } from "./SessionTreeNavigator";

type NavigateCallback = (targetId: string, summaryChoice: SessionTreeSummaryChoice) => Promise<SessionTreeNavigateResult>;
type ForkCallback = (entryId: string) => Promise<SessionTreeForkResult>;
type VoidMethod = (this: SessionTreeNavigator) => void;
type PromiseMethod = (this: SessionTreeNavigator) => Promise<void>;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("session-tree-navigator reading lenses", () => {
  it("opens on the user lens and lands the cursor on the nearest user message", async () => {
    const navigator = await mountNavigator({ filter: "default" });

    expect(visibleRowIds(navigator)).toEqual(["root"]);
    expect(filterButton(navigator, "User").getAttribute("aria-pressed")).toBe("true");
    expect(deepActiveElement()).toBe(treeItem(navigator, "root"));
  });

  it("returns to the anchored entry when the lens widens again", async () => {
    const navigator = await mountNavigator({ filter: "default" });

    await selectFilter(navigator, "All");

    expect(visibleRowIds(navigator)).toEqual(["root", "active", "side"]);
    expect(componentProperty(navigator, "selectedId")).toBe("active");
  });

  it("keeps a hand-picked entry across a lens change", async () => {
    const navigator = await mountNavigator();
    treeItem(navigator, "side").click();
    await settleRenderedDialog(navigator);

    await selectFilter(navigator, "User");
    expect(componentProperty(navigator, "selectedId")).toBe("root");

    await selectFilter(navigator, "All");
    expect(componentProperty(navigator, "selectedId")).toBe("side");
  });

  it("counts the selected position within the active lens", async () => {
    const navigator = await mountNavigator();

    expect(countText(navigator)).toBe("2 / 3");

    await selectFilter(navigator, "User");
    expect(countText(navigator)).toBe("1 / 1");
  });

  it("filters as you search and says so when nothing matches", async () => {
    const navigator = await mountNavigator();

    await typeSearch(navigator, "side");
    expect(visibleRowIds(navigator)).toEqual(["side"]);
    expect(componentProperty(navigator, "selectedId")).toBe("side");

    await typeSearch(navigator, "nothing here");
    expect(renderedTree(navigator)).toBeNull();
    expect(shadowText(navigator)).toContain("No history entries match this search");

    await typeSearch(navigator, "");
    expect(visibleRowIds(navigator)).toEqual(["root", "active", "side"]);
  });

  it("copies the selected entry text and reports clipboard refusal", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText }, configurable: true });
    const navigator = await mountNavigator();

    copyButton(navigator).click();
    await settleRenderedDialog(navigator);
    expect(writeText).toHaveBeenCalledWith("Active answer");
    expect(shadowText(navigator)).toContain("Entry text copied");

    writeText.mockRejectedValueOnce(new Error("denied"));
    copyButton(navigator).click();
    await settleRenderedDialog(navigator);
    expect(shadowText(navigator)).toContain("blocked clipboard access");
  });

  it("explains an empty lens differently from an empty session", async () => {
    const navigator = await mountNavigator();

    await selectFilter(navigator, "Labeled");

    expect(renderedTree(navigator)).toBeNull();
    expect(shadowText(navigator)).toContain("No history entries match this filter");
    expect(footerButton(navigator, "Next").disabled).toBe(true);
  });
});

describe("session-tree-navigator modal surface", () => {
  it("focuses the selected history row when opened", async () => {
    const navigator = await mountNavigator();

    expect(deepActiveElement()).toBe(treeItem(navigator, "active"));
  });

  it("focuses the close button when opened with an empty tree", async () => {
    const navigator = await mountNavigator({ tree: { nodes: [], activeLeafId: null, activePathIds: [] } });

    expect(deepActiveElement()).toBe(closeButton(navigator));
  });

  it("cancels from the tree step on Escape", async () => {
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onCancel });

    pressKey(dialogSurface(navigator), "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("returns to the tree step from the action step on Escape instead of cancelling", async () => {
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onCancel });
    await advanceToAction(navigator);

    pressKey(dialogSurface(navigator), "Escape");
    await settleRenderedDialog(navigator);

    expect(onCancel).not.toHaveBeenCalled();
    expect(renderedTree(navigator)).not.toBeNull();
  });

  // The surface owns one dismissal route, so a backdrop press steps back from
  // the action step exactly like Escape instead of closing outright.
  it("steps back from the action step on a backdrop press and cancels from the tree step", async () => {
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onCancel });
    await advanceToAction(navigator);

    backdropPress(navigator);
    await settleRenderedDialog(navigator);

    expect(onCancel).not.toHaveBeenCalled();
    expect(renderedTree(navigator)).not.toBeNull();

    backdropPress(navigator);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight summarization on Escape and swallows backdrop presses while busy", async () => {
    const navigation = deferred<SessionTreeNavigateResult>();
    const onNavigate = vi.fn<NavigateCallback>(() => navigation.promise);
    const onAbort = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onNavigate, onAbort, onCancel });
    await advanceToAction(navigator);
    summarizeToggle(navigator).click();
    await settleRenderedDialog(navigator);
    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    backdropPress(navigator);
    pressKey(dialogSurface(navigator), "Escape");

    expect(onCancel).not.toHaveBeenCalled();
    expect(onAbort).toHaveBeenCalledOnce();

    navigation.resolve({ cancelled: true, aborted: true });
    await settleRenderedDialog(navigator);
  });

  it("swallows Escape while a plain navigation is in flight", async () => {
    const navigation = deferred<SessionTreeNavigateResult>();
    const onNavigate = vi.fn<NavigateCallback>(() => navigation.promise);
    const onAbort = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onNavigate, onAbort, onCancel });
    await advanceToAction(navigator);
    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    pressKey(dialogSurface(navigator), "Escape");

    expect(onAbort).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    navigation.resolve({ cancelled: false });
    await settleRenderedDialog(navigator);
  });

  // A fork in flight gets the same busy contract as a plain navigation: Escape
  // and backdrop presses are swallowed (only summarization can be aborted).
  it("swallows Escape and backdrop presses while a fork is in flight", async () => {
    const fork = deferred<SessionTreeForkResult>();
    const onFork = vi.fn<ForkCallback>(() => fork.promise);
    const onAbort = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn<() => void>();
    const navigator = await mountNavigator({ onFork, onAbort, onCancel });
    await advanceToAction(navigator);
    footerButton(navigator, "Fork into new session").click();
    await settleRenderedDialog(navigator);

    backdropPress(navigator);
    pressKey(dialogSurface(navigator), "Escape");

    expect(onAbort).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(footerButton(navigator, "Forking…").disabled).toBe(true);

    fork.resolve({ cancelled: true });
    await settleRenderedDialog(navigator);
    expect(navigator.renderRoot.querySelector("h2")?.textContent).toBe("Continue from this entry");
    expect(shadowText(navigator)).toContain("Fork cancelled. No new session was created");
  });
});

describe("session-tree-navigator location step", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps operation selection out of step 1 and offers only Cancel and Next", async () => {
    const navigator = await mountNavigator();

    expect(footerLabels(navigator)).toEqual(["Cancel", "Next"]);
    expect(shadowText(navigator)).toContain("Select the history entry where you would like to continue.");
    expect(navigator.renderRoot.querySelector("input[name='session-tree-summarize']")).toBeNull();
    expect(footerButton(navigator, "Next").classList.contains("primary")).toBe(true);
    expect(footerButton(navigator, "Next").disabled).toBe(false);
  });

  it("keeps an empty history inert", async () => {
    const navigator = await mountNavigator({ tree: { nodes: [], activeLeafId: null, activePathIds: [] } });

    expect(shadowText(navigator)).toContain("does not contain any selectable history entries");
    expect(footerLabels(navigator)).toEqual(["Cancel", "Next"]);
    expect(footerButton(navigator, "Next").disabled).toBe(true);
  });

  it("uses the same semantic kind badge treatment in the tree and selected-entry steps", async () => {
    const navigator = await mountNavigator();
    const root = treeItem(navigator, "root");
    root.click();
    await settleRenderedDialog(navigator);

    const treeBadge = kindBadge(root);
    expect(treeBadge.textContent).toBe("User");
    expect(treeBadge.classList.contains("kind-tone-user")).toBe(true);
    expect(root.classList.contains("kind-tone-user")).toBe(false);

    await advanceToAction(navigator);
    const selectedEntry = navigator.renderRoot.querySelector(".selected-entry");
    if (!(selectedEntry instanceof HTMLElement)) throw new Error("Selected entry was unavailable");
    const actionBadge = kindBadge(selectedEntry);
    expect(actionBadge.textContent).toBe("User");
    expect(actionBadge.classList.contains("kind-tone-user")).toBe(true);
    expect(selectedEntry.classList.contains("kind-tone-user")).toBe(false);
  });

  it("ignores f and F but advances with Enter", async () => {
    const navigator = await mountNavigator();
    const selected = treeItem(navigator, "active");

    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "F", bubbles: true }));
    await settleRenderedDialog(navigator);

    expect(navigator.renderRoot.querySelector("[role='tree']")).toBeTruthy();
    expect(navigator.renderRoot.querySelector("h2")).toBeNull();

    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settleRenderedDialog(navigator);

    expect(navigator.renderRoot.querySelector("h2")?.textContent).toBe("Continue from this entry");
    expect(footerLabels(navigator)).toEqual(["Back", "Fork into new session", "Continue from here"]);
  });

  it("moves focus across steps and traps Tab in the dialog", async () => {
    const navigator = await mountNavigator();
    const next = footerButton(navigator, "Next");

    expect(navigator.shadowRoot?.activeElement).toBe(treeItem(navigator, "active"));

    next.focus();
    pressKey(dialogSurface(navigator), "Tab");
    expect(navigator.shadowRoot?.activeElement).toBe(closeButton(navigator));

    dialogSurface(navigator).dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true, composed: true }));
    expect(navigator.shadowRoot?.activeElement).toBe(next);

    next.click();
    await settleRenderedDialog(navigator);
    expect(navigator.shadowRoot?.activeElement).toBe(footerButton(navigator, "Continue from here"));

    footerButton(navigator, "Back").click();
    await settleRenderedDialog(navigator);
    expect(navigator.shadowRoot?.activeElement).toBe(treeItem(navigator, "active"));
  });

  it("uses Back and Escape to revisit location, then Escape to cancel", async () => {
    const onCancel = vi.fn();
    const navigator = await mountNavigator({ onCancel });

    await advanceToAction(navigator);
    footerButton(navigator, "Back").click();
    await settleRenderedDialog(navigator);
    expect(navigator.renderRoot.querySelector("[role='tree']")).toBeTruthy();

    await advanceToAction(navigator);
    pressKey(dialogSurface(navigator), "Escape");
    await settleRenderedDialog(navigator);
    expect(navigator.renderRoot.querySelector("[role='tree']")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();

    treeItem(navigator, "active").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("session-tree-navigator action step", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("offers continue and fork as footer actions with the summary off by default", async () => {
    const navigator = await mountNavigator();
    await advanceToAction(navigator);

    expect(navigator.renderRoot.querySelector("input[type='radio']")).toBeNull();
    expect(footerLabels(navigator)).toEqual(["Back", "Fork into new session", "Continue from here"]);
    expect(footerButton(navigator, "Continue from here").classList.contains("primary")).toBe(true);
    expect(footerButton(navigator, "Fork into new session").classList.contains("primary")).toBe(false);
    expect(summarizeToggle(navigator).checked).toBe(false);
    expect(navigator.renderRoot.querySelector("#session-tree-custom-focus")).toBeNull();
    expect(selectedEntryText(navigator)).toContain("prompt editor will be empty");
    expect(shadowText(navigator)).toContain("starts a separate session file with this entry and all history leading to it");
    expect(shadowText(navigator)).toContain("Neither action undoes filesystem changes");

    summarizeToggle(navigator).click();
    await settleRenderedDialog(navigator);
    expect(customFocus(navigator)).toBeTruthy();

    summarizeToggle(navigator).click();
    await settleRenderedDialog(navigator);
    expect(navigator.renderRoot.querySelector("#session-tree-custom-focus")).toBeNull();
  });

  it("explains user-message restoration and the fork draft for user entries", async () => {
    const navigator = await mountNavigator();
    treeItem(navigator, "root").click();
    await settleRenderedDialog(navigator);
    await advanceToAction(navigator);

    expect(selectedEntryText(navigator)).toContain("text will return to the prompt editor for optional editing and resubmission in this session");
    expect(shadowText(navigator)).toContain("branches before this message");
    expect(shadowText(navigator)).toContain("draft for the new session");
  });

  it("dispatches footer actions to their callbacks and retains location after cancellation", async () => {
    const onNavigate = vi.fn<NavigateCallback>().mockResolvedValue({ cancelled: true });
    const onFork = vi.fn<ForkCallback>().mockResolvedValue({ cancelled: true });
    const navigator = await mountNavigator({ onNavigate, onFork });

    treeItem(navigator, "side").click();
    await settleRenderedDialog(navigator);
    await advanceToAction(navigator);
    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    expect(onNavigate).toHaveBeenCalledWith("side", { mode: "none" });
    expect(onFork).not.toHaveBeenCalled();
    expect(navigator.renderRoot.querySelector("[role='tree']")).toBeTruthy();
    expect(shadowText(navigator)).toContain("selected history entry is unchanged");

    await advanceToAction(navigator);
    footerButton(navigator, "Fork into new session").click();
    await settleRenderedDialog(navigator);

    expect(onFork).toHaveBeenCalledWith("side");
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(navigator.renderRoot.querySelector("h2")?.textContent).toBe("Continue from this entry");
    expect(selectedEntryText(navigator)).toContain("Side branch");
    expect(navigator.renderRoot.querySelector(".dialog-status[role='status']")?.textContent).toContain("Fork cancelled. No new session was created");
  });

  it("treats blank summary focus as the default summary", async () => {
    const onNavigate = vi.fn<NavigateCallback>().mockResolvedValue({ cancelled: false });
    const navigator = await mountNavigator({ onNavigate });
    await advanceToAction(navigator);

    summarizeToggle(navigator).click();
    await settleRenderedDialog(navigator);
    const textarea = customFocus(navigator);
    textarea.value = "   ";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleRenderedDialog(navigator);
    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    expect(onNavigate).toHaveBeenCalledWith("active", { mode: "default" });
  });

  it("submits trimmed custom focus and exposes disabled busy controls and cancellation", async () => {
    const navigation = deferred<SessionTreeNavigateResult>();
    const onNavigate = vi.fn<NavigateCallback>(() => navigation.promise);
    const onAbort = vi.fn(() => Promise.resolve());
    const navigator = await mountNavigator({ onNavigate, onAbort });
    await advanceToAction(navigator);

    summarizeToggle(navigator).click();
    await settleRenderedDialog(navigator);
    const textarea = customFocus(navigator);
    textarea.value = "  focus on failed tests  ";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleRenderedDialog(navigator);
    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    expect(onNavigate).toHaveBeenCalledWith("active", { mode: "custom", instructions: "focus on failed tests" });
    expect(summaryFieldset(navigator)?.disabled).toBe(true);
    expect(closeButton(navigator).disabled).toBe(true);
    expect(footerButton(navigator, "Back").disabled).toBe(true);
    expect(footerButton(navigator, "Fork into new session").disabled).toBe(true);
    expect(footerButton(navigator, "Summarizing…").disabled).toBe(true);
    expect(footerButton(navigator, "Cancel summarization").disabled).toBe(false);

    pressKey(dialogSurface(navigator), "Escape");
    await settleRenderedDialog(navigator);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(footerButton(navigator, "Cancelling…").disabled).toBe(true);

    navigation.resolve({ cancelled: true, aborted: true });
    await settleRenderedDialog(navigator);
    expect(navigator.renderRoot.querySelector("[role='tree']")).toBeTruthy();
    expect(shadowText(navigator)).toContain("Summarization cancelled");
  });

  it("keeps navigation failures visible and actionable in step 2", async () => {
    const navigator = await mountNavigator();
    navigator.onNavigate = () => Promise.reject(new Error("The session changed since /tree was opened."));
    await advanceToAction(navigator);

    footerButton(navigator, "Continue from here").click();
    await settleRenderedDialog(navigator);

    expect(navigator.renderRoot.querySelector("h2")?.textContent).toBe("Continue from this entry");
    expect(navigator.renderRoot.querySelector(".dialog-error[role='alert']")?.textContent).toContain("Could not navigate session history: The session changed since /tree was opened.");
    expect(footerButton(navigator, "Continue from here").disabled).toBe(false);
  });

  it("keeps fork failures visible and actionable in step 2", async () => {
    const navigator = await mountNavigator();
    navigator.onFork = () => Promise.reject(new Error("Restart the session daemon to enable tree forks."));
    await advanceToAction(navigator);

    footerButton(navigator, "Fork into new session").click();
    await settleRenderedDialog(navigator);

    expect(navigator.renderRoot.querySelector("h2")?.textContent).toBe("Continue from this entry");
    expect(navigator.renderRoot.querySelector(".dialog-error[role='alert']")?.textContent).toContain("Restart the session daemon to enable tree forks.");
    expect(footerButton(navigator, "Fork into new session").disabled).toBe(false);
  });

  it("disables the whole step while a fork is in flight", async () => {
    const forkResult = deferred<SessionTreeForkResult>();
    const navigator = await mountNavigator();
    navigator.onFork = () => forkResult.promise;
    await advanceToAction(navigator);

    footerButton(navigator, "Fork into new session").click();
    await settleRenderedDialog(navigator);

    expect(summaryFieldset(navigator)?.disabled).toBe(true);
    expect(closeButton(navigator).disabled).toBe(true);
    expect(footerButton(navigator, "Back").disabled).toBe(true);
    expect(footerButton(navigator, "Forking…").disabled).toBe(true);
    expect(footerButton(navigator, "Continue from here").disabled).toBe(true);
    expect(footerLabels(navigator)).not.toContain("Cancel summarization");

    forkResult.resolve({ cancelled: true });
    await settleRenderedDialog(navigator);
    expect(footerButton(navigator, "Fork into new session").disabled).toBe(false);
    expect(shadowText(navigator)).toContain("Fork cancelled. No new session was created");
  });
});

describe("session-tree-navigator interactions", () => {
  it("uses pointer selection for explicit navigation and retains it after cancellation", async () => {
    const navigator = initializedNavigator();
    const onNavigate = vi.fn<NavigateCallback>().mockResolvedValue({ cancelled: true, aborted: true });
    navigator.onNavigate = onNavigate;

    templateClickHandlerForText(renderNavigator(navigator), "Side branch")(new Event("click"));
    clickTreeNext(navigator);
    await callPromiseMethod(navigator, "submitNavigation");

    expect(onNavigate).toHaveBeenNthCalledWith(1, "side", { mode: "none" });
    expect(componentProperty(navigator, "step")).toBe("tree");
    expect(componentProperty(navigator, "statusMessage")).toContain("selected history entry is unchanged");

    clickTreeNext(navigator);
    await callPromiseMethod(navigator, "submitNavigation");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "side", { mode: "none" });
  });

  it("submits a default summary when the focus text is blank", async () => {
    const navigator = initializedNavigator();
    const onNavigate = vi.fn<NavigateCallback>().mockResolvedValue({ cancelled: false });
    navigator.onNavigate = onNavigate;

    clickTreeNext(navigator);
    setComponentProperty(navigator, "summarize", true);
    setComponentProperty(navigator, "customInstructions", "   ");
    await callPromiseMethod(navigator, "submitNavigation");

    expect(onNavigate).toHaveBeenCalledWith("active", { mode: "default" });
  });

  it("submits trimmed custom focus, exposes busy cancellation, and returns to the same node", async () => {
    const navigation = deferred<SessionTreeNavigateResult>();
    const navigator = initializedNavigator();
    const onNavigate = vi.fn<NavigateCallback>(() => navigation.promise);
    const onAbort = vi.fn(() => Promise.resolve());
    navigator.onNavigate = onNavigate;
    navigator.onAbort = onAbort;

    clickTreeNext(navigator);
    setComponentProperty(navigator, "summarize", true);
    setComponentProperty(navigator, "customInstructions", "  focus on failed tests  ");

    const submission = callPromiseMethod(navigator, "submitNavigation");
    expect(componentProperty(navigator, "busy")).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith("active", { mode: "custom", instructions: "focus on failed tests" });

    await callPromiseMethod(navigator, "abortNavigation");
    expect(onAbort).toHaveBeenCalledOnce();
    expect(componentProperty(navigator, "aborting")).toBe(true);

    navigation.resolve({ cancelled: true, aborted: true });
    await submission;
    expect(componentProperty(navigator, "busy")).toBe(false);
    expect(componentProperty(navigator, "selectedId")).toBe("active");
    expect(componentProperty(navigator, "step")).toBe("tree");
  });

  it("clears transient cancelling status if navigation rejects after abort", async () => {
    const navigation = deferred<SessionTreeNavigateResult>();
    const navigator = initializedNavigator();
    navigator.onNavigate = () => navigation.promise;
    navigator.onAbort = () => Promise.resolve();

    clickTreeNext(navigator);
    setComponentProperty(navigator, "summarize", true);
    const submission = callPromiseMethod(navigator, "submitNavigation");
    await callPromiseMethod(navigator, "abortNavigation");
    expect(componentProperty(navigator, "statusMessage")).toBe("Cancelling summarization…");

    navigation.reject(new Error("remote operation failed"));
    await submission;

    expect(componentProperty(navigator, "statusMessage")).toBe("");
    expect(componentProperty(navigator, "error")).toBe("Could not navigate session history: remote operation failed");
  });

  it("keeps navigation failures actionable and local to the action step", async () => {
    const navigator = initializedNavigator();
    navigator.onNavigate = () => Promise.reject(new Error("The session changed since /tree was opened. Reopen /tree and try again."));

    clickTreeNext(navigator);
    await callPromiseMethod(navigator, "submitNavigation");

    expect(componentProperty(navigator, "step")).toBe("action");
    expect(componentProperty(navigator, "busy")).toBe(false);
    expect(componentProperty(navigator, "error")).toBe("Could not navigate session history: The session changed since /tree was opened. Reopen /tree and try again.");
  });

  it("focuses the active leaf selected when the dialog opens", () => {
    const navigator = initializedNavigator();
    const activeFocus = vi.fn();
    const activeScroll = vi.fn();
    const root = {
      querySelector: () => null,
      querySelectorAll: () => [
        { dataset: { treeNodeId: "root" }, focus: vi.fn(), scrollIntoView: vi.fn() },
        { dataset: { treeNodeId: "active" }, focus: activeFocus, scrollIntoView: activeScroll },
      ],
    };
    if (!Reflect.set(navigator, "renderRoot", root)) throw new Error("Could not install navigator render root");

    callVoidMethod(navigator, "focusSelectedTreeItem");

    expect(activeFocus).toHaveBeenCalledOnce();
    expect(activeScroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("keeps an empty tree inert and moves initial focus to the close boundary", async () => {
    const navigator = new SessionTreeNavigator();
    navigator.tree = { nodes: [], activeLeafId: null, activePathIds: [] };
    const onNavigate = vi.fn<NavigateCallback>().mockResolvedValue({ cancelled: false });
    navigator.onNavigate = onNavigate;
    const closeFocus = vi.fn();
    const root = {
      querySelector: (selector: string) => selector === ".close-button" ? { focus: closeFocus } : null,
      querySelectorAll: () => [],
    };
    if (!Reflect.set(navigator, "renderRoot", root)) throw new Error("Could not install navigator render root");
    callVoidMethod(navigator, "resetTree");

    callVoidMethod(navigator, "focusSelectedTreeItem");
    callVoidMethod(navigator, "continueToAction");
    await callPromiseMethod(navigator, "submitNavigation");

    expect(componentProperty(navigator, "selectedId")).toBeUndefined();
    expect(componentProperty(navigator, "step")).toBe("tree");
    expect(closeFocus).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("session-tree-navigator display helpers", () => {
  it("maps every node kind to its semantic badge treatment and readable label", () => {
    const actual: Record<SessionTreeNodeKind, ReturnType<typeof sessionTreeKindPresentation>> = {
      user: sessionTreeKindPresentation("user"),
      assistant: sessionTreeKindPresentation("assistant"),
      "tool-result": sessionTreeKindPresentation("tool-result"),
      bash: sessionTreeKindPresentation("bash"),
      "custom-message": sessionTreeKindPresentation("custom-message"),
      compaction: sessionTreeKindPresentation("compaction"),
      "branch-summary": sessionTreeKindPresentation("branch-summary"),
      "model-change": sessionTreeKindPresentation("model-change"),
      "thinking-level-change": sessionTreeKindPresentation("thinking-level-change"),
      "session-info": sessionTreeKindPresentation("session-info"),
      label: sessionTreeKindPresentation("label"),
      custom: sessionTreeKindPresentation("custom"),
      other: sessionTreeKindPresentation("other"),
    };

    expect(actual).toEqual({
      user: { label: "User", tone: "user", bookkeeping: false },
      assistant: { label: "Assistant", tone: "assistant", bookkeeping: false },
      "tool-result": { label: "Tool result", tone: "tool", bookkeeping: false },
      bash: { label: "Shell", tone: "shell", bookkeeping: false },
      "custom-message": { label: "Custom message", tone: "context", bookkeeping: false },
      compaction: { label: "Compaction", tone: "context", bookkeeping: false },
      "branch-summary": { label: "Branch summary", tone: "context", bookkeeping: false },
      "model-change": { label: "Model", tone: "metadata", bookkeeping: true },
      "thinking-level-change": { label: "Thinking", tone: "metadata", bookkeeping: true },
      "session-info": { label: "Session info", tone: "metadata", bookkeeping: true },
      label: { label: "Label", tone: "metadata", bookkeeping: true },
      custom: { label: "Custom", tone: "metadata", bookkeeping: true },
      other: { label: "Other", tone: "metadata", bookkeeping: true },
    });
  });

  it("describes Pi's editor-return semantics and bounds pathological visual indentation", () => {
    expect(sessionTreeEntryReturnsToEditor("user")).toBe(true);
    expect(sessionTreeEntryReturnsToEditor("custom-message")).toBe(true);
    expect(sessionTreeEntryReturnsToEditor("assistant")).toBe(false);
    expect(sessionTreeEntryReturnsToEditor("tool-result")).toBe(false);
    expect(sessionTreeVisualDepth(-1)).toBe(0);
    expect(sessionTreeVisualDepth(7)).toBe(7);
    expect(sessionTreeVisualDepth(20_000)).toBe(8);
  });
});

interface MountedNavigatorProps {
  tree?: SessionTreeSnapshot;
  onNavigate?: NavigateCallback;
  onFork?: ForkCallback;
  onAbort?: () => Promise<void>;
  onCancel?: () => void;
  /** "default" keeps the shipped opening lens instead of widening to All. */
  filter?: "default";
}

async function mountNavigator(props: MountedNavigatorProps = {}): Promise<SessionTreeNavigator> {
  const element = document.createElement("session-tree-navigator");
  if (!(element instanceof SessionTreeNavigator)) throw new Error("session-tree-navigator element was not upgraded");
  element.tree = props.tree ?? tree();
  element.onNavigate = props.onNavigate ?? (() => Promise.resolve({ cancelled: false }));
  if (props.onFork !== undefined) element.onFork = props.onFork;
  if (props.onAbort !== undefined) element.onAbort = props.onAbort;
  if (props.onCancel !== undefined) element.onCancel = props.onCancel;
  document.body.append(element);
  await settleRenderedDialog(element);
  // These cases drive navigation over the whole fixture forest, so they open the
  // widest lens through the real control. The default lens has its own tests.
  if (props.filter !== "default") await selectFilter(element, "All");
  return element;
}

async function selectFilter(navigator: SessionTreeNavigator, label: string): Promise<void> {
  filterButton(navigator, label).click();
  await settleRenderedDialog(navigator);
}

function filterButton(navigator: SessionTreeNavigator, label: string): HTMLButtonElement {
  for (const button of navigator.renderRoot.querySelectorAll(".filters button")) {
    if (button instanceof HTMLButtonElement && button.textContent.trim() === label) return button;
  }
  throw new Error(`Filter "${label}" was unavailable`);
}

async function advanceToAction(navigator: SessionTreeNavigator): Promise<void> {
  footerButton(navigator, "Next").click();
  await settleRenderedDialog(navigator);
}

function renderedTree(navigator: SessionTreeNavigator): Element | null {
  return navigator.shadowRoot?.querySelector("[role='tree']") ?? null;
}

function visibleRowIds(navigator: SessionTreeNavigator): string[] {
  return [...navigator.renderRoot.querySelectorAll("[data-tree-node-id]")]
    .map((row) => (row instanceof HTMLElement ? row.dataset["treeNodeId"] ?? "" : ""));
}

async function typeSearch(navigator: SessionTreeNavigator, value: string): Promise<void> {
  const input = navigator.renderRoot.querySelector(".search");
  if (!(input instanceof HTMLInputElement)) throw new Error("Search input was unavailable");
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await settleRenderedDialog(navigator);
}

function copyButton(navigator: SessionTreeNavigator): HTMLButtonElement {
  const button = navigator.renderRoot.querySelector(".copy");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Copy button was unavailable");
  return button;
}

function countText(navigator: SessionTreeNavigator): string {
  const count = navigator.renderRoot.querySelector(".count");
  if (!(count instanceof HTMLElement)) throw new Error("Entry count was unavailable");
  return count.textContent.replace(/\s+/g, " ").trim();
}

function backdropPress(navigator: SessionTreeNavigator): void {
  surfaceBackdrop(navigator).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
}

function tree(): SessionTreeSnapshot {
  return {
    nodes: [
      { id: "root", parentId: null, kind: "user", summary: "Initial prompt" },
      { id: "active", parentId: "root", kind: "assistant", summary: "Active answer" },
      { id: "side", parentId: "root", kind: "assistant", summary: "Side branch" },
    ],
    activeLeafId: "active",
    activePathIds: ["root", "active"],
  };
}

function treeItem(navigator: SessionTreeNavigator, id: string): HTMLElement {
  const item = navigator.renderRoot.querySelector(`[data-tree-node-id='${id}']`);
  if (!(item instanceof HTMLElement)) throw new Error(`Tree item "${id}" was unavailable`);
  return item;
}

function kindBadge(container: ParentNode): HTMLElement {
  const badge = container.querySelector(".kind");
  if (!(badge instanceof HTMLElement)) throw new Error("Kind badge was unavailable");
  return badge;
}

function closeButton(navigator: SessionTreeNavigator): HTMLButtonElement {
  const button = navigator.renderRoot.querySelector(".close-button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Close button was unavailable");
  return button;
}

function footerButton(navigator: SessionTreeNavigator, label: string): HTMLButtonElement {
  for (const button of navigator.renderRoot.querySelectorAll("footer button")) {
    if (button.textContent.trim() !== label) continue;
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Footer button "${label}" is not a button element`);
    return button;
  }
  throw new Error(`Footer button "${label}" was unavailable`);
}

function footerLabels(navigator: SessionTreeNavigator): string[] {
  return [...navigator.renderRoot.querySelectorAll("footer button")].map((button) => button.textContent.trim());
}

function summarizeToggle(navigator: SessionTreeNavigator): HTMLInputElement {
  const input = navigator.renderRoot.querySelector("input[name='session-tree-summarize']");
  if (!(input instanceof HTMLInputElement)) throw new Error("Summarize toggle was unavailable");
  return input;
}

function summaryFieldset(navigator: SessionTreeNavigator): HTMLFieldSetElement | null {
  const fieldset = navigator.renderRoot.querySelector("fieldset.summary-section");
  return fieldset instanceof HTMLFieldSetElement ? fieldset : null;
}

function customFocus(navigator: SessionTreeNavigator): HTMLTextAreaElement {
  const textarea = navigator.renderRoot.querySelector("#session-tree-custom-focus");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Custom summary focus was unavailable");
  return textarea;
}

function selectedEntryText(navigator: SessionTreeNavigator): string {
  return navigator.renderRoot.querySelector(".selected-entry")?.textContent ?? "";
}

function shadowText(navigator: SessionTreeNavigator): string {
  return navigator.renderRoot.textContent;
}

// Method-level harness for the interaction tests: drives the navigator without
// a DOM attachment and reads private state by name.
function initializedNavigator(filter: "default" | "all" = "all"): SessionTreeNavigator {
  const navigator = new SessionTreeNavigator();
  navigator.tree = tree();
  callVoidMethod(navigator, "resetTree");
  // The fixture's leaf is an assistant answer, which the shipped opening lens
  // hides. Widen unless the case is specifically about that lens.
  if (filter === "all") callFilterMethod(navigator, "all");
  return navigator;
}

function callFilterMethod(navigator: SessionTreeNavigator, filter: SessionTreeFilterMode): void {
  const method: unknown = Reflect.get(navigator, "selectFilter");
  if (!isFilterMethod(method)) throw new Error("SessionTreeNavigator.selectFilter is not callable");
  method.call(navigator, filter);
}

function isFilterMethod(value: unknown): value is (mode: SessionTreeFilterMode) => void {
  return typeof value === "function";
}

function renderNavigator(navigator: SessionTreeNavigator): TemplateResult {
  return navigator.render();
}

function clickTreeNext(navigator: SessionTreeNavigator): void {
  templateEventHandlerNearMarker(renderNavigator(navigator), ">Next</button>")(new Event("click"));
}

function componentProperty(navigator: SessionTreeNavigator, property: string): unknown {
  return Reflect.get(navigator, property);
}

function setComponentProperty(navigator: SessionTreeNavigator, property: string, value: unknown): void {
  if (!Reflect.set(navigator, property, value)) throw new Error(`Could not set navigator property ${property}`);
}

function callVoidMethod(navigator: SessionTreeNavigator, methodName: string): void {
  const method: unknown = Reflect.get(navigator, methodName);
  if (!isVoidMethod(method)) throw new Error(`SessionTreeNavigator.${methodName} is not callable`);
  method.call(navigator);
}

async function callPromiseMethod(navigator: SessionTreeNavigator, methodName: string): Promise<void> {
  const method: unknown = Reflect.get(navigator, methodName);
  if (!isPromiseMethod(method)) throw new Error(`SessionTreeNavigator.${methodName} is not callable`);
  await method.call(navigator);
}

function isVoidMethod(value: unknown): value is VoidMethod {
  return typeof value === "function";
}

function isPromiseMethod(value: unknown): value is PromiseMethod {
  return typeof value === "function";
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
