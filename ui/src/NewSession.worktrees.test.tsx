// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSession, type LaunchDraft, type Placement } from "./NewSession";
import { createDeferredFiles, type NewSessionApi, type Project, type Workspace } from "./newSession";
import type { SessionModel } from "./contracts";
import { createDraftStore } from "./draftStore";
import { createLaunchStore, type WorktreeListener } from "./launches";
import type { WorktreeApi, WorktreeRecord } from "./worktrees/worktreeApi";
import { WorktreeDialog } from "./ui/WorktreeActions";
import type { ComposerInputElement } from "./ui/ComposerEditor";

let root: Root;
const opus: SessionModel = { provider: "p", id: "opus", name: "Opus", reasoning: true };
const projects: Project[] = [{ id: "p1", name: "forgerie", path: "/code/forgerie" }, { id: "p2", name: "notes", path: "/code/notes" }];
const workspaces: Record<string, Workspace[]> = {
  p1: [{ id: "w1", path: "/code/forgerie", label: "main", branch: "main", isMain: true },
    { id: "w2", path: "/code/forgerie/.worktree/ui", label: "ui", branch: "feat/ui", isMain: false }],
  p2: [{ id: "w3", path: "/code/notes", label: "notes", isMain: true }],
};
type StartArgs = Parameters<NewSessionApi["start"]>;
type StartResult = Awaited<ReturnType<NewSessionApi["start"]>>;
const failedRecord = (extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({ id: "wt1", repo: "/code/forgerie", path: "/code/forgerie/.worktree/s-1", branch: "s-1",
  defaultBranch: "main", setup: { phase: "failed", log: "npm ERR! missing script", exitCode: 1, error: "Post-create hook exited with 1" },
  state: { kind: "active" }, cleanup: { kind: "pending" }, updatedAt: "2026-10-06T00:00:00Z", ...extra });

function harness(outcome: (args: StartArgs) => StartResult | Promise<StartResult> = ([cwd]) => ({ type: "started", session: { id: "s-new", cwd } }), inventory: WorktreeRecord[] = []) {
  const starts: StartArgs[] = [];
  const api: NewSessionApi = {
    projects: async () => projects,
    workspaces: async (id) => workspaces[id] ?? [],
    models: async () => ({ models: [opus], model: opus, thinkingLevel: "high" }),
    promptResources: async () => [],
    start: async (...args) => { starts.push(args); return outcome(args); },
  };
  const worktrees: Pick<WorktreeApi, "options" | "list" | "land" | "discardPreview" | "discard"> = {
    options: async (cwd) => cwd.startsWith("/code/forgerie") ? { kind: "git", repo: "/code/forgerie", defaultBranch: "main", defaultCwd: "/code/forgerie", defaultDestination: "existing-workspace" } : { kind: "non-git" },
    list: async () => inventory,
    land: async () => ({ kind: "landed", sha: "abc1234", cleanup: { kind: "done" } }),
    discardPreview: async (id) => ({ worktreeId: id, branch: "s-1", defaultBranch: "main", commits: [], dirtyFiles: [], confirmationToken: "tok" }),
    discard: async () => ({ kind: "discarded", cleanup: { kind: "done" } }),
  };
  let emit: WorktreeListener = () => {};
  const launches = createLaunchStore<LaunchDraft>(api, { onWorktree: (listener) => { emit = listener; return () => {}; } });
  return { api, worktrees, launches, starts, emit: (record: WorktreeRecord) => emit(record) };
}
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(h: ReturnType<typeof harness>, options: { cwd?: string; placement?: Placement; onDestination?: (cwd: string, placement?: Placement) => void } = {}) {
  await act(async () => root.render(<NewSession cwd={options.cwd ?? "/code/forgerie/.worktree/ui"} initialPlacement={options.placement} api={h.api} worktrees={h.worktrees}
    launches={h.launches} deferred={createDeferredFiles()} drafts={createDraftStore(undefined)} onStarted={() => {}} onClose={() => {}} onDestination={options.onDestination} />));
  await settle();
}
const textarea = () => document.querySelector<ComposerInputElement>(".ns-dialog [data-composer-input]")!;
const label = () => document.querySelector(".destination-value")!.textContent;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim().startsWith(name) || node.getAttribute("aria-label") === name);
const click = async (node: HTMLElement | undefined) => { expect(node).toBeDefined(); await act(async () => node!.click()); await settle(); };
async function type(text: string) {
  await act(async () => {
    textarea().value = text;
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

describe("a new session's worktree", () => {
  it("defaults a Git project to its main checkout even when opened from a linked worktree", async () => {
    const h = harness();
    const models = vi.spyOn(h.api, "models");
    const resources = vi.spyOn(h.api, "promptResources");
    await render(h);
    expect(label()).toBe("forgerie");
    expect(models).toHaveBeenLastCalledWith("/code/forgerie", expect.any(AbortSignal));
    expect(resources).toHaveBeenLastCalledWith("/code/forgerie", expect.any(AbortSignal));
    await type("Fix the login");
    await send();
    expect(h.starts[0]![0]).toBe("/code/forgerie");
    expect(h.starts[0]![3]?.destination).toBeUndefined();
  });

  it("uses a named default branch checkout rather than assuming it is called main", async () => {
    const h = harness();
    h.worktrees.options = async () => ({ kind: "git", repo: "/code/forgerie", defaultBranch: "trunk",
      defaultCwd: "/code/forgerie/.worktree/trunk", defaultDestination: "existing-workspace" });
    await render(h);
    expect(label()).toBe("forgerie · trunk");
    await type("Fix the login");
    await send();
    expect(h.starts[0]![0]).toBe("/code/forgerie/.worktree/trunk");
    expect(h.starts[0]![3]?.destination).toBeUndefined();
  });

  it("waits for the default checkout before enabling the first send", async () => {
    const h = harness();
    let resolve!: (value: Awaited<ReturnType<WorktreeApi["options"]>>) => void;
    h.worktrees.options = () => new Promise((done) => { resolve = done; });
    await render(h);
    await type("Fix it");
    expect(button("Start session")?.disabled).toBe(true);
    await send();
    expect(h.starts).toEqual([]);
    await act(async () => resolve({ kind: "git", repo: "/code/forgerie", defaultBranch: "main",
      defaultCwd: "/code/forgerie", defaultDestination: "existing-workspace" }));
    await settle();
    expect(button("Start session")?.disabled).toBe(false);
    await send();
    expect(h.starts[0]![0]).toBe("/code/forgerie");
  });

  it("reuses the current project's branch options when opening its workspace menu", async () => {
    const h = harness();
    const options = vi.spyOn(h.worktrees, "options");
    await render(h);
    expect(options).toHaveBeenCalledTimes(1);
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(document.querySelector<HTMLButtonElement>('[data-option-id="p1"]')!);
    expect(options).toHaveBeenCalledTimes(1);
    expect(button("New worktreefrom main")).toBeDefined();
  });

  it("does not expose workspace targets before a cold project's branch options arrive", async () => {
    const h = harness();
    const original = h.worktrees.options;
    let resolve!: (value: Awaited<ReturnType<WorktreeApi["options"]>>) => void;
    h.worktrees.options = (cwd, signal) => cwd === "/code/notes" ? new Promise((done) => { resolve = done; }) : original(cwd, signal);
    await render(h);
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(document.querySelector<HTMLButtonElement>('[data-option-id="p2"]')!);
    expect(document.querySelector('[data-option-id="w3"]')).toBeNull();
    expect(document.querySelector('[aria-label="Workspaces of notes"]')?.textContent).toContain("Loading workspaces");
    await act(async () => resolve({ kind: "git", repo: "/code/notes", defaultBranch: "trunk", defaultCwd: "/code/notes", defaultDestination: "existing-workspace" }));
    await settle();
    expect(button("New worktreefrom trunk")).toBeDefined();
    expect(document.querySelector('[data-option-id="w3"]')).not.toBeNull();
  });

  it("keeps New worktree available when the workspace list fails", async () => {
    const h = harness();
    h.api.workspaces = async () => { throw new Error("Workspace list unavailable"); };
    await render(h);
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(document.querySelector<HTMLButtonElement>('[data-option-id="p1"]')!);
    expect(document.querySelector('[aria-label="Workspaces of forgerie"]')?.textContent).toContain("Workspaces unavailable: Workspace list unavailable");
    expect(document.querySelector('[data-option-id="w1"]')).toBeNull();
    await click(button("New worktreefrom main"));
    expect(label()).toBe("forgerie · new worktree from main");
    await type("Fix in isolation");
    await send();
    expect(h.starts[0]![3]).toMatchObject({ destination: { kind: "fresh-worktree" } });
  });

  it("keeps fresh worktree creation as an explicit choice", async () => {
    const h = harness();
    const onDestination = vi.fn();
    await render(h, { onDestination });
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(document.querySelector<HTMLButtonElement>('[data-option-id="p1"]')!);
    expect(button("New worktreefrom main")?.getAttribute("aria-current")).not.toBe("true");
    expect(document.querySelector('[data-option-id="w1"]')?.getAttribute("aria-current")).toBe("true");
    await click(button("New worktreefrom main"));
    expect(label()).toBe("forgerie · new worktree from main");
    expect(onDestination).toHaveBeenLastCalledWith("/code/forgerie", "fresh");
    await type("Fix in isolation");
    await send();
    expect(h.starts[0]![0]).toBe("/code/forgerie");
    expect(h.starts[0]![3]).toMatchObject({ destination: { kind: "fresh-worktree" } });
  });

  it("keeps an explicit fresh choice from the URL", async () => {
    const h = harness();
    await render(h, { placement: "fresh" });
    expect(label()).toBe("forgerie · new worktree from main");
  });

  it("selects an existing workspace explicitly, and says so on the next reload", async () => {
    const h = harness();
    const onDestination = vi.fn();
    await render(h, { onDestination });
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(document.querySelector<HTMLButtonElement>('[data-option-id="p1"]')!);
    expect(document.querySelector('[data-option-id="w1"]')?.getAttribute("aria-current")).toBe("true");
    await click([...document.querySelectorAll<HTMLButtonElement>(".option-row")].find((row) => row.textContent?.startsWith("feat/ui")));
    expect(label()).toBe("forgerie · feat/ui");
    expect(onDestination).toHaveBeenLastCalledWith("/code/forgerie/.worktree/ui", "existing");
    await type("Fix it here");
    await send();
    expect(h.starts[0]![0]).toBe("/code/forgerie/.worktree/ui");
    expect(h.starts[0]![3]).toMatchObject({ destination: { kind: "existing-workspace" } });
  });

  it("keeps an explicit existing choice from the URL", async () => {
    const h = harness();
    await render(h, { placement: "existing" });
    expect(label()).toBe("forgerie · ui");
  });

  it("preserves an explicit fresh choice when options cannot be read", async () => {
    const h = harness();
    h.worktrees.options = async () => { throw new Error("Options unavailable"); };
    await render(h, { placement: "fresh" });
    await type("Fix in isolation");
    await send();
    expect(h.starts[0]![3]).toMatchObject({ destination: { kind: "fresh-worktree" } });
  });

  it("starts a project outside Git in its folder, with no worktree offer", async () => {
    const h = harness();
    await render(h, { cwd: "/code/notes" });
    expect(label()).toBe("notes");
    await type("x");
    await send();
    expect(h.starts[0]![3]).toMatchObject({ destination: { kind: "existing-workspace" } });
  });

  it("shows setup steps while the worktree is prepared", async () => {
    let finish!: (result: StartResult) => void;
    const h = harness(() => new Promise((done) => { finish = done; }));
    await render(h, { placement: "fresh" });
    await type("Fix it");
    await send();
    const token = (h.starts[0]![3] as { startupToken: string }).startupToken;
    await act(async () => h.emit(failedRecord({ startupToken: token, setup: { phase: "hook", log: "added 3 packages" } })));
    expect(document.querySelector(".wt-setup-title")?.textContent).toBe("Preparing worktree");
    expect([...document.querySelectorAll(".wt-steps li")].map((step) => step.getAttribute("data-state"))).toEqual(["done", "running", "waiting"]);
    expect(document.querySelector(".wt-log-tail")?.textContent).toBe("added 3 packages");
    await act(async () => finish({ type: "started", session: { id: "s1", cwd: "/x" } }));
  });

  it("keeps a failed setup with its exit code and log, and retries it in the same worktree", async () => {
    const h = harness(([, , , options]) => {
      h.emit(failedRecord({ startupToken: options?.startupToken }));
      return { type: "failed", failure: { stage: "start", message: "Post-create hook exited with 1", maybeStarted: true } };
    });
    await render(h, { placement: "fresh" });
    await type("Fix it");
    await send();
    expect(document.querySelector(".wt-setup-title")?.textContent).toBe("Worktree setup failed");
    expect(document.querySelector(".wt-exit")?.textContent).toBe("exit 1");
    expect(document.querySelector(".wt-log pre")?.textContent).toBe("npm ERR! missing script");
    // The message is back in the bar for the retry.
    expect(textarea().value).toBe("Fix it");
    await click(button("Retry setup"));
    expect(h.starts[1]![3]).toMatchObject({ setupId: "wt1", destination: { kind: "fresh-worktree" } });
  });

  it("finds a failed setup from an earlier visit in the server's inventory", async () => {
    const h = harness(undefined, [failedRecord()]);
    await render(h);
    expect(document.querySelector(".ns-tray")?.textContent).toContain("worktree-post-create exited with 1");
    await click(button("View setup"));
    expect(document.querySelector(".wt-setup-title")?.textContent).toBe("Worktree setup failed");
  });
});

describe("Land and Discard", () => {
  const info = { id: "wt1", owned: true, repo: "/r", path: "/r/.worktree/s-1", branch: "fix-login", defaultBranch: "main",
    state: { kind: "active" as const }, setup: { phase: "done" as const, log: "" }, cleanup: { kind: "pending" as const }, ahead: 4, dirtyFiles: 0 };
  const api = (extra: Partial<Pick<WorktreeApi, "land" | "discardPreview" | "discard">> = {}): Pick<WorktreeApi, "land" | "discardPreview" | "discard"> => ({
    land: async () => ({ kind: "landed", sha: "0123456789", cleanup: { kind: "done" } }),
    discardPreview: async () => ({ worktreeId: "wt1", branch: "fix-login", defaultBranch: "main", confirmationToken: "tok",
      commits: [{ sha: "aaaaaaa1", subject: "Add form" }, { sha: "bbbbbbb2", subject: "Fix test" }, { sha: "ccccccc3", subject: "Docs" }, { sha: "ddddddd4", subject: "Lint" }], dirtyFiles: [] }),
    discard: async () => ({ kind: "discarded", cleanup: { kind: "done" } }),
    ...extra,
  });

  it("asks before landing, then names the sha", async () => {
    const onDone = vi.fn();
    await act(async () => root.render(<WorktreeDialog command="land" info={info} api={api()} onDone={onDone} onClose={() => {}} />));
    expect(document.querySelector(".wt-lead")?.textContent).toContain("4 commits land on main");
    await click(button("Land on main"));
    expect(document.querySelector(".wt-outcome-title")?.textContent).toBe("Landed on main at 0123456");
    expect(onDone).toHaveBeenCalledWith({ kind: "landed", sha: "0123456789", cleanup: { kind: "done" } });
  });

  it("offers a conflict to the agent as its prompt, and does nothing else", async () => {
    const onAsk = vi.fn(async () => {});
    const onClose = vi.fn();
    await act(async () => root.render(<WorktreeDialog command="land" info={info} onAsk={onAsk} onDone={() => {}} onClose={onClose}
      api={api({ land: async () => ({ kind: "conflict", files: ["src/a.ts", "src/b.ts"], defaultBranch: "main", prompt: "Rebase onto main and resolve src/a.ts, src/b.ts" }) })} />));
    await click(button("Land on main"));
    expect([...document.querySelectorAll(".wt-list li")].map((item) => item.textContent)).toEqual(["src/a.ts", "src/b.ts"]);
    await click(button("Ask the agent to resolve"));
    expect(onAsk).toHaveBeenCalledWith("Rebase onto main and resolve src/a.ts, src/b.ts");
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the unlanded commits before Discard, and sends the preview's token", async () => {
    const discard = vi.fn(async () => ({ kind: "discarded" as const, cleanup: { kind: "done" as const } }));
    await act(async () => root.render(<WorktreeDialog command="discard" info={info} api={api({ discard })} onDone={() => {}} onClose={() => {}} />));
    await settle();
    expect(document.querySelector(".wt-lead")?.textContent).toMatch(/^4 commits not on main will be lost/u);
    expect(document.querySelectorAll(".wt-list li")).toHaveLength(4);
    await click(button("Discard worktree"));
    expect(discard).toHaveBeenCalledWith("wt1", "tok");
    expect(document.querySelector(".wt-outcome-title")?.textContent).toBe("Worktree discarded");
  });

  it("reads a new preview when the work changed, and asks again", async () => {
    const preview = vi.fn(api().discardPreview);
    await act(async () => root.render(<WorktreeDialog command="discard" info={info} onDone={() => {}} onClose={() => {}}
      api={api({ discardPreview: preview, discard: async () => ({ kind: "stale-preview" }) })} />));
    await settle();
    await click(button("Discard worktree"));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".wt-warning")?.textContent).toContain("changed since this list");
    expect(button("Discard worktree")?.disabled).toBe(false);
  });
});
