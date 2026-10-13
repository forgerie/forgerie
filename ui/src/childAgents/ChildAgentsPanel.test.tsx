// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildAgentsPanel, type ChildAgentsActions } from "./ChildAgentsPanel";
import { ChildEntryView } from "./ChildEntryView";
import { FINISHED, DISCARD, RUNS } from "./fixtures/childWork";
import { CHILDREN, NOW, OVERLOADED, RETRYING, STREAMING, TRANSCRIPT } from "./fixtures/children";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const actions = (): ChildAgentsActions => ({ onOpenChild: vi.fn(), onBack: vi.fn(), onClose: vi.fn(), onSend: vi.fn(() => Promise.resolve()),
  onStop: vi.fn(), onAnswer: vi.fn(() => Promise.resolve()), onReview: vi.fn(), onLand: vi.fn(), onPreviewDiscard: vi.fn(), onDiscard: vi.fn(),
  onContinue: vi.fn(() => Promise.resolve()), onRuns: vi.fn(), onCleanup: vi.fn(), onBackDetail: vi.fn(), onDismissOutcome: vi.fn(), onRetryDetail: vi.fn() });
const fields = () => [...document.querySelectorAll("textarea")].map((field) => field.getAttribute("aria-label"));
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text);

describe("child agents panel", () => {
  it("offers one input: the answer while a question is open, shown as a card where it was asked", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={21} transcript={TRANSCRIPT} actions={actions()} />));
    expect(fields()).toEqual(["Answer ui: Should the empty state show the last run, or stay blank?"]);
    expect(document.querySelectorAll(".question-card")).toHaveLength(1);
    // The question is a card, not a tool line.
    expect([...document.querySelectorAll(".exchange-log-name")].map((node) => node.textContent)).toEqual(["read"]);
  });

  it("steers a working child, with Stop in the header", async () => {
    const handlers = actions();
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={15} transcript={STREAMING} actions={handlers} />));
    expect(fields()).toEqual(["Message api"]);
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Steer api while it works");
    await act(async () => { button("Stop")?.click(); });
    expect(handlers.onStop).toHaveBeenCalledWith(15);
    expect(document.querySelector(".exchange-log-out")?.hasAttribute("data-streaming")).toBe(true);
  });

  it("gives an idle child a new task, without Stop", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={33} transcript={{ ...TRANSCRIPT, messages: TRANSCRIPT.messages.slice(0, 3), busy: false }} actions={actions()} />));
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Give review another task");
    expect(button("Stop")).toBeUndefined();
  });

  it("pins branch actions, explains dirty refusal, and requires a tap before another task", async () => {
    const handlers = actions();
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} transcript={{ messages: [], busy: false }} actions={handlers} />));
    expect(fields()).toEqual([]);
    expect(button("Land")?.closest("footer")).not.toBeNull();
    await act(async () => button("Review changes")!.click());
    expect(handlers.onReview).toHaveBeenCalledWith(44);
    await act(async () => button("Continue working")!.click());
    expect(fields()).toEqual(["Message builder"]);
    await act(async () => button("Branch actions")!.click());
    await act(async () => root.render(<ChildAgentsPanel children={[{ ...FINISHED, worktree: { ...FINISHED.worktree!, dirty: true } }]} openId={44} transcript={{ messages: [], busy: false }} actions={handlers} />));
    expect(button("Land")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Commit the changed files");
  });

  it("removed worktrees have no old composer and name the destination of new work", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={[{ ...FINISHED, worktree: { ...FINISHED.worktree!, state: "landed", cleanup: { kind: "done" } } }]} openId={44} actions={actions()} />));
    expect(fields()).toEqual([]);
    await act(async () => button("Start new task from main")!.click());
    expect(fields()).toEqual(["New task from main"]);
    expect(document.body.textContent).toContain("fresh worktree from main");
  });

  it("confirmation sends the preview's exact token and Keep does not discard", async () => {
    const handlers = actions();
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} detail={DISCARD} actions={handlers} />));
    expect(document.body.textContent).toContain("README.md");
    await act(async () => button("Keep worktree")!.click());
    expect(handlers.onBackDetail).toHaveBeenCalledOnce();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
    await act(async () => button("Discard worktree")!.click());
    expect(handlers.onDiscard).toHaveBeenCalledWith(44, "fixture-confirmation");
  });

  it("shows actual history totals and disclosure content", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} detail={{ kind: "runs", data: RUNS }} actions={actions()} />));
    expect(document.body.textContent).toContain("Estimated cost: $0.51");
    expect(document.querySelectorAll("details")).toHaveLength(1);
    expect(document.body.textContent).toContain("1600");
    expect(document.body.textContent).toContain("worker.md");
  });

  it("preserves steering and answer drafts across idle transitions and history", async () => {
    const handlers = actions();
    const working = { ...FINISHED, busy: true };
    await act(async () => root.render(<ChildAgentsPanel children={[working]} openId={44} transcript={{ messages: [], busy: true }} actions={handlers} />));
    await act(async () => {
      const field = document.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep this draft");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} transcript={{ messages: [], busy: false }} actions={handlers} />));
    await act(async () => button("Continue working")!.click());
    expect(document.querySelector("textarea")?.value).toBe("Keep this draft");
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} detail={{ kind: "runs", data: RUNS }} actions={handlers} />));
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} actions={handlers} />));
    expect(document.querySelector("textarea")?.value).toBe("Keep this draft");
  });

  it("renders an aborted question as closed in the child's own record", async () => {
    const transcript = { busy: false, messages: [...TRANSCRIPT.messages, { role: "toolResult" as const, toolName: "ask_human", isError: true, content: "Tool ask_human was aborted" }] };
    await act(async () => root.render(<ChildAgentsPanel children={[FINISHED]} openId={44} transcript={transcript} actions={actions()} />));
    expect(document.querySelector(".question-card")?.hasAttribute("data-open")).toBe(false);
    expect(document.body.textContent).toContain("Question ended without an answer");
    expect(fields()).toEqual([]);
  });

  it("cancelled parent questions have no answer control", async () => {
    await act(async () => root.render(<ChildEntryView entry={{ kind: "question", questionId: "q", child: 44, childName: "builder", question: "Go?", cancelled: true }} onAnswer={async () => {}} />));
    expect(fields()).toEqual([]);
    expect(document.body.textContent).toContain("Stopped without an answer");
  });

  it("shows a report's first line in the text face, with the rest on request", async () => {
    await act(async () => root.render(<ChildEntryView entry={{ kind: "report", childName: "api", outcome: "answered", text: "**Added** GET /api/runs.\n\nTests: 14 passed." }} />));
    expect(document.querySelector(".event-line-quote")?.textContent).toBe("Added GET /api/runs.");
    expect(document.querySelector(".event-line-quote")?.getAttribute("data-face")).toBe("text");
    expect(document.querySelector(".event-line-detail")?.textContent).toContain("Tests: 14 passed.");
  });

  it("counts down a retry in the child's row and shows the whole error in its record", async () => {
    let now = NOW;
    const clock = () => now;
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<ChildAgentsPanel children={[RETRYING, CHILDREN[2]!]} actions={actions()} now={clock} />));
      const row = document.querySelector(".status-row");
      expect(row?.getAttribute("data-tone")).toBe("retrying");
      expect(row?.querySelector(".status-row-status")?.textContent).toBe("Next try in 1 min 40 s");
      expect(row?.querySelector(".status-row-below")?.textContent).toMatch(/^Retrying 2 of 3: 529 \{"type":"error".*…$/u);
      // The row ticks on its own while the retry waits.
      now = NOW + 99_500;
      await act(async () => { vi.advanceTimersByTime(1_000); });
      expect(row?.querySelector(".status-row-status")?.textContent).toBe("Next try in 1 s");
      now = NOW + 100_000;
      await act(async () => { vi.advanceTimersByTime(1_000); });
      expect(row?.querySelector(".status-row-status")?.textContent).toBe("Trying again now");
    } finally { vi.useRealTimers(); }
    const handlers = actions();
    await act(async () => root.render(<ChildAgentsPanel children={[RETRYING]} openId={15} transcript={{ ...STREAMING, partial: undefined, busy: false }} actions={handlers} now={() => NOW} />));
    expect(document.querySelector(".sheet-dialog-subtitle")?.textContent).toContain("Retrying 2 of 3");
    const card = document.querySelector('[aria-label="api is retrying"]');
    expect(card?.getAttribute("data-tone")).toBe("warn");
    expect(card?.textContent).toContain("Retrying 2 of 3");
    expect(card?.textContent).toContain("Next try in 1 min 40 s.");
    expect(card?.querySelector("pre")?.textContent).toBe(OVERLOADED);
    // The child is still at work between tries: the input steers it, and Stop reaches it.
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Steer api while it works");
    await act(async () => { button("Stop")?.click(); });
    expect(handlers.onStop).toHaveBeenCalledWith(15);
  });
});
