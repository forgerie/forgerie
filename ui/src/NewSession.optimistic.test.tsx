// @vitest-environment happy-dom
import { act, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewSession, type LaunchDraft } from "./NewSession";
import { PendingSession } from "./app/PendingSession.binding";
import { createLaunchStore, type Launch, type WorktreeListener } from "./launches";
import { createDeferredFiles, type NewSessionApi } from "./newSession";
import type { BacklogApi, BacklogItem } from "./backlog/backlogApi";
import type { WorktreeApi, WorktreeRecord } from "./worktrees/worktreeApi";
import type { ComposerInputElement } from "./ui/ComposerEditor";
import { attachmentDelivery } from "./attachmentDelivery";

let root: Root;
const input = () => document.querySelector<ComposerInputElement>(".ns-dialog [data-composer-input]")!;
const dialog = () => document.querySelector<HTMLDialogElement>(".ns-dialog")!;
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text)!;
const until = async (check: () => boolean) => { await act(async () => { await expect.poll(check, { timeout: 3000 }).toBe(true); }); };
const click = (node: HTMLElement) => act(async () => node.click());
const failed: WorktreeRecord = { id: "wt1", repo: "/workspace", path: "/workspace/.worktree/task", branch: "task", defaultBranch: "main",
  setup: { phase: "failed", log: "Old setup log", exitCode: 1 }, state: { kind: "active" }, cleanup: { kind: "pending" } };
const item: BacklogItem = { id: "01A", provider: "markdown", projectId: "p1", projectName: "Workspace", repo: "/workspace",
  title: "Carried work", path: "work/items/a.md", status: "To Do", labels: [], assignedToMe: true, assignees: [], open: true,
  readiness: "ready", blockingIds: [], owner: { kind: "project", projectId: "p1", projectName: "Workspace", repo: "/workspace" },
  destination: { kind: "routed", projectId: "p1", reason: "project-owned" } } as BacklogItem;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); attachmentDelivery.set("inline"); vi.unstubAllGlobals(); });

async function render() {
  let resolve!: (result: Awaited<ReturnType<NewSessionApi["start"]>>) => void;
  const promise = new Promise<Awaited<ReturnType<NewSessionApi["start"]>>>(done => { resolve = done; });
  const reply = { promise, resolve };
  const starts: Parameters<NewSessionApi["start"]>[] = [];
  const opus = { provider: "p", id: "opus", name: "Opus", reasoning: true };
  const other = { ...opus, id: "other", name: "Other model" };
  const api: NewSessionApi = {
    projects: async () => [{ id: "p1", name: "Workspace", path: "/workspace" }],
    workspaces: async () => [{ id: "w1", path: "/workspace", label: "main", isMain: true }],
    models: async () => ({ models: [opus, other], model: opus, thinkingLevel: "high" }),
    promptResources: async () => [], start: async (...args) => { starts.push(args); return reply.promise; },
  };
  const worktrees: Pick<WorktreeApi, "options" | "list" | "land" | "discardPreview" | "discard"> = {
    options: async () => ({ kind: "git", repo: "/workspace", defaultBranch: "main", defaultCwd: "/workspace", defaultDestination: "existing-workspace" }),
    list: async () => [failed], land: async () => ({ kind: "landed", sha: "abc", cleanup: { kind: "done" } }),
    discardPreview: async () => ({ worktreeId: "wt1", branch: "task", defaultBranch: "main", commits: [], dirtyFiles: [], confirmationToken: "t" }),
    discard: async () => ({ kind: "discarded", cleanup: { kind: "done" } }),
  };
  const backlog: Pick<BacklogApi, "detail"> = { detail: async () => ({ item, body: "Work", initialPrompt: "Carried work" }) };
  let emit: WorktreeListener = () => {};
  const launches = createLaunchStore<LaunchDraft>(api, { onWorktree: listener => { emit = listener; return () => {}; } });
  const deferred = createDeferredFiles();
  function Preview() {
    const [restore, setRestore] = useState<Launch<LaunchDraft>>();
    const [open, setOpen] = useState(true);
    const [pending, setPending] = useState<string>();
    const list = useSyncExternalStore(launches.subscribe, launches.getSnapshot);
    const launch = list.find(item => item.id === pending);
    return <>{launch && <PendingSession launch={launch} recovery={{
      onRestore: () => { setRestore(launch); setPending(undefined); setOpen(true); },
      onRetrySetup: () => { const next = launches.retrySetup(launch.id); if (next) setPending(next.id); }, worktrees,
    }} />}{open && <NewSession key={restore?.id} initialLaunch={restore} cwd="/workspace" initialPlacement="existing" api={api} worktrees={worktrees}
      item={{ projectId: "p1", itemId: "01A" }} backlog={backlog} launches={launches} deferred={deferred}
      onLaunching={id => { setPending(id); setOpen(false); }} onStarted={() => {}} onClose={() => {}} />}</>;

  }
  await act(async () => root.render(<Preview />));
  await until(() => document.querySelector(".model-trigger")?.textContent?.includes("Opus") === true && document.querySelector(".bl-carry-title")?.textContent === "Carried work");
  return { reply, starts, emit: (record: WorktreeRecord) => emit(record) };
}

it("restores chosen settings, exact text, files, images and carried item only on explicit recovery", async () => {
  const h = await render();
  await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
  await click(button("Other model", document.querySelector(".floating-panel")!));
  await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
  await click(button("Low", document.querySelector(".model-levels")!));
  const files = [new File(["notes"], "notes.txt", { type: "text/plain" }), new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" })];
  attachmentDelivery.set("inline");
  await act(async () => {
    const picker = document.querySelector<HTMLInputElement>('.ns-dialog input[type="file"]')!;
    Object.defineProperty(picker, "files", { configurable: true, value: files }); picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until(() => document.querySelector(".ns-dialog .composer-attachments")?.textContent?.includes("screen.png") === true);
  const authored = "  Keep this draft.\n\nAnd its whitespace.  \n";
  await act(async () => { input().value = authored; input().dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button("Start session"));
  await until(() => h.starts.length === 1);
  expect(dialog()).toBeNull(); expect(document.querySelector("dialog[open]")).toBeNull();
  expect(h.starts[0]?.[2]).toMatchObject({ model: { id: "other" }, thinkingLevel: "low" });
  expect(h.starts[0]?.[3]).toMatchObject({ destination: { kind: "existing-workspace" }, item: { itemId: "01A" } });
  expect(h.starts[0]?.[1]).toMatchObject({ text: authored.trim(), files: [{ name: "notes.txt" }], images: [{ name: "screen.png" }] });
  await act(async () => h.reply.resolve({ type: "failed", failure: { stage: "start", message: "Unavailable", maybeStarted: false } }));
  await until(() => document.querySelector(".session-shell")?.textContent?.includes("Unavailable") === true);
  expect(dialog()).toBeNull();
  await click(button("Restore draft"));
  await until(() => dialog().open && input().value === authored && document.querySelector(".ns-dialog .composer-attachments")?.textContent?.includes("screen.png") === true);
  expect(document.querySelector(".ns-dialog .composer-attachments")?.textContent).toContain("notes.txt");
  expect(document.querySelector(".ns-dialog .model-trigger")?.textContent).toContain("Other model");
  expect(document.querySelector(".ns-dialog .model-trigger")?.textContent).toContain("Low");
  expect(document.querySelector(".ns-dialog .bl-carry-title")?.textContent).toBe("Carried work");
  expect(document.querySelector(".ns-dialog .destination-value")?.textContent).toBe("Workspace");

});

it("keeps a failed setup and its retry controls on the pending page", async () => {
  const h = await render();
  await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
  await click(document.querySelector<HTMLButtonElement>('[data-option-id="specific:p1"]')!);
  await click([...document.querySelectorAll<HTMLButtonElement>(".option-row")].find(node => node.textContent?.startsWith("New worktree"))!);
  await click(button("Start session")); // The carried item can start without typed words.
  await until(() => h.starts.length === 1);
  const token = h.starts[0]![3]!.startupToken;
  await act(async () => h.emit({ ...failed, startupToken: token, setup: { phase: "hook", log: "Installing dependencies" } }));
  expect(document.querySelector(".session-shell .wt-log-tail")?.textContent).toBe("Installing dependencies");
  await act(async () => {
    h.emit({ ...failed, startupToken: token, setup: { phase: "failed", log: "Dependency install failed", exitCode: 7 } });
    h.reply.resolve({ type: "failed", failure: { stage: "start", message: "Setup failed", maybeStarted: true } });
  });
  await until(() => document.querySelector(".session-shell .wt-exit")?.textContent === "exit 7");
  expect(dialog()).toBeNull();
  expect(document.querySelector(".session-shell .wt-log")?.textContent).toContain("Dependency install failed");
  expect(button("Retry setup")).toBeDefined(); expect(button("Discard worktree…")).toBeDefined();
  await click(button("Retry setup"));
  expect(h.starts[1]?.[3]).toMatchObject({ setupId: "wt1", destination: { kind: "fresh-worktree" }, item: { itemId: "01A" } });
  expect(dialog()).toBeNull();
  await until(() => button("Restore draft") !== undefined);
  await click(button("Restore draft"));
  await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
  await click(document.querySelector<HTMLButtonElement>('[data-option-id="p1"]')!);
  await click(button("Start session"));
  expect(h.starts[2]?.[3]?.setupId).toBeUndefined();
  expect(h.starts[2]?.[3]?.destination).toBeUndefined();
});
