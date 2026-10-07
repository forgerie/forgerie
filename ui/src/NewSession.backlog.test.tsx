// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSession, type LaunchDraft } from "./NewSession";
import { createDeferredFiles, type NewSessionApi, type StartFailure } from "./newSession";
import type { Session, SessionModel } from "./contracts";
import { createDraftStore } from "./draftStore";
import { createLaunchStore } from "./launches";
import type { BacklogApi, BacklogClaim, BacklogDetail, BacklogItem } from "./backlog/backlogApi";

let root: Root;
const opus: SessionModel = { provider: "p", id: "opus", name: "Opus", reasoning: true };
type StartArgs = Parameters<NewSessionApi["start"]>;
type StartResult = Awaited<ReturnType<NewSessionApi["start"]>>;
const item = (extra: Partial<BacklogItem> = {}): BacklogItem => ({ id: "01A", title: "Fix the nested transcript", projectId: "p1", projectName: "forgerie",
  repo: "/code/forgerie", path: "work/items/a.md", status: "To Do", labels: [], open: true, readiness: "ready", blockingIds: [], ...extra });
const held: BacklogClaim = { kind: "claimed", claimId: "c1", projectId: "p1", itemId: "01A", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9",
  claimedAt: "2026-10-07T10:00:00Z", sessionId: "s-held" };

function harness(options: { detail?: Partial<BacklogItem>; outcome?: (args: StartArgs) => StartResult } = {}) {
  const starts: StartArgs[] = [];
  const api: NewSessionApi = {
    projects: async () => [{ id: "p1", name: "forgerie", path: "/code/forgerie" }],
    workspaces: async () => [],
    models: async () => ({ models: [opus], model: opus, thinkingLevel: "high" }),
    promptResources: async () => [],
    start: async (...args) => { starts.push(args); return options.outcome?.(args) ?? { type: "started", session: { id: "s-new", cwd: args[0] } }; },
  };
  const backlog: Pick<BacklogApi, "detail"> = {
    detail: async (): Promise<BacklogDetail> => ({ item: item(options.detail), body: "# Fix", initialPrompt: "This is backlog item 01A.\n\n# Fix" }),
  };
  const launches = createLaunchStore<LaunchDraft>(api);
  return { api, backlog, launches, starts };
}
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(h: ReturnType<typeof harness>, extra: { onStarted?: (session: Session) => void; onItemRemoved?: () => void } = {}) {
  await act(async () => root.render(<NewSession cwd="/code/forgerie" api={h.api} launches={h.launches} deferred={createDeferredFiles()} drafts={createDraftStore(undefined)}
    item={{ projectId: "p1", itemId: "01A" }} backlog={h.backlog} lookSession={(id) => id === "s-held" ? { state: "working", name: "Atomic deploys", time: "41m" } : undefined}
    onStarted={extra.onStarted ?? (() => {})} onClose={() => {}} onItemRemoved={extra.onItemRemoved} />));
  await settle();
}
const textarea = () => document.querySelector<HTMLTextAreaElement>(".ns-dialog textarea")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim().startsWith(name) || node.getAttribute("aria-label") === name);
const click = async (node: HTMLElement | undefined) => { expect(node).toBeDefined(); await act(async () => node!.click()); await settle(); };
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), text);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const send = async () => { await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ctrlKey: true })); }); await settle(); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("a new session with a backlog item", () => {
  it("shows the item at the top of the writing area and says what starting does", async () => {
    await render(harness());
    expect(document.querySelector(".bl-carry-title")!.textContent).toBe("Fix the nested transcript");
    expect(document.querySelector(".bl-note")!.textContent).toContain("until you archive it");
    expect(textarea().placeholder).toContain("start with the item as written");
  });

  it("starts with the item alone: Start works with no typed words", async () => {
    const h = harness();
    await render(h);
    const start = button("Start session")!;
    expect(start.disabled).toBe(false);
    await click(start);
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]![1]).toMatchObject({ text: "" });
    expect(h.starts[0]![3]).toMatchObject({ item: { projectId: "p1", itemId: "01A" } });
  });

  it("sends the typed words with the item", async () => {
    const h = harness();
    await render(h);
    await type("Start with the scanner.");
    await send();
    expect(h.starts[0]![1]).toMatchObject({ text: "Start with the scanner." });
    expect(h.starts[0]![3]).toMatchObject({ item: { projectId: "p1", itemId: "01A" } });
  });

  it("when another session took the item first: names it, keeps the words, and offers the two ways on", async () => {
    const taken: StartFailure = { stage: "start", message: "Backlog item is already claimed", maybeStarted: false, taken: held };
    const h = harness({ outcome: () => ({ type: "failed", failure: taken }) });
    const opened: Session[] = [];
    let removed = 0;
    await render(h, { onStarted: (session) => opened.push(session), onItemRemoved: () => { removed += 1; } });
    await type("Keep nested runs out of the inbox.");
    await send();
    expect(document.querySelector(".bl-refusal")!.textContent).toContain("Atomic deploys took this item first");
    expect(document.querySelector(".bl-carry-where")!.textContent).toBe("Taken by Atomic deploys 41m ago");
    expect(textarea().value).toBe("Keep nested runs out of the inbox.");
    expect(button("Start session")!.disabled).toBe(true);
    await click(button("Open Atomic deploys"));
    expect(opened).toEqual([{ id: "s-held", cwd: "/code/forgerie/.worktree/s-9" }]);
    await click(button("Start without the item"));
    expect(removed).toBe(1);
    expect(document.querySelector(".bl-carry")).toBeNull();
    expect(button("Start session")!.disabled).toBe(false);
    await send();
    expect(h.starts[1]![3]).not.toHaveProperty("item");
  });

  it("refuses up front an item that is blocked, and says why", async () => {
    const h = harness({ detail: { readiness: "blocked", blockingIds: ["02B"] } });
    await render(h);
    expect(document.querySelector(".bl-carry-where")!.textContent).toContain("Waiting on 1 other item");
    await type("Go");
    await send();
    expect(h.starts).toHaveLength(0);
    expect(button("Start session")!.disabled).toBe(true);
  });
});
