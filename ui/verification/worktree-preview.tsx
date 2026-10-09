// Dev-only entry point for session-worktree states. No transport or network data.
// Scenarios (?scenario=): new, new-picker, new-hook, new-failed, session, session-menu,
// land, conflict, discard, landed, discarded, picker, archive-note.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import "../src/ui/theme.css";
import type { SessionModel } from "../src/contracts";
import type { TranscriptMessage } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { AppShell } from "../src/ui/AppShell";
import { ToastRegion } from "../src/ui/ToastRegion";
import { Picker, PickerToast } from "../src/ui/Picker";
import { NewSession, type LaunchDraft } from "../src/NewSession";
import { createLaunchStore, type WorktreeListener } from "../src/launches";
import { createDeferredFiles, type NewSessionApi, type Project, type Workspace } from "../src/newSession";
import { rows as boardRows, sections as boardSections, createLocationResolver, DEFAULT_COLLAPSED } from "../src/picker/board";
import type { WorktreeApi, WorktreeInfo, WorktreeRecord } from "../src/worktrees/worktreeApi";
import { WorktreeChip } from "../src/ui/WorktreeChip";
import { SessionMenu, WorktreeDialog, type WorktreeCommand } from "../src/ui/WorktreeActions";
import { WorktreeReceipt, WorktreeSetupCard } from "../src/ui/WorktreeSetupCard";
import { ArchiveNextButton } from "../src/ui/ArchiveNext";
import { TreeOpener } from "../src/ui/SessionTreeNavigator";
import type { ComposerInputElement } from "../src/ui/ComposerEditor";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "session";
const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const transcript: TranscriptMessage[] = [
  say("q", "user", "The login form accepts an empty password. Fix it and add a regression test."),
  say("a", "assistant", "Fixed in `src/auth/LoginForm.tsx`: the submit handler now refuses an empty password and says why.\n\nI added `LoginForm.test.tsx` with three cases and committed both on this worktree's branch."),
];
const repo = "/home/simon/code/sandbox/forgerie";
const branch = "fix-empty-password-login";
const models: SessionModel[] = [{ provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true }];
const hookLog = "> forgerie@1.202610.0 postinstall\n> node scripts/postinstall.mjs\n\nadded 812 packages, and audited 813 packages in 14s\n\n142 packages are looking for funding\n  run `npm fund` for details";
const failedLog = `${hookLog}\nnpm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! forgerie@1.202610.0 prepare: \`node scripts/build-native.mjs\`\nnpm ERR! Exit status 1\nnpm ERR! Failed at the forgerie@1.202610.0 prepare script.`;

const info = (extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  id: "wt1", owned: true, repo, path: `${repo}/.worktree/s-01a114`, branch, defaultBranch: "main",
  state: { kind: "active" }, setup: { phase: "done", log: hookLog }, cleanup: { kind: "pending" }, ahead: 4, behind: 0, dirtyFiles: 2, ...extra,
});
const record = (extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({
  id: "wt1", repo, path: `${repo}/.worktree/s-01a114`, branch: "s-01a114", defaultBranch: "main", setup: { phase: "creating", log: "" },
  state: { kind: "active" }, cleanup: { kind: "pending" }, updatedAt: "2026-10-06T21:00:00Z", ...extra,
});
const projects: Project[] = [{ id: "p1", name: "forgerie", path: repo }, { id: "p2", name: "notes", path: "/home/simon/notes" }];
const workspaces: Record<string, Workspace[]> = {
  p1: [{ id: "w1", path: repo, label: "main", branch: "main", isMain: true },
    { id: "w2", path: `${repo}/.worktree/new-ui-mvp`, label: "new-ui-mvp", branch: "new-ui-mvp", isMain: false }],
};

// A local worktree API with scripted outcomes.
const worktreeApi: Pick<WorktreeApi, "options" | "list" | "land" | "discardPreview" | "discard" | "get"> = {
  options: async (cwd) => cwd.startsWith(repo) ? { kind: "git", repo, defaultBranch: "main", defaultDestination: "fresh-worktree" } : { kind: "non-git" },
  list: async () => scenario === "new-failed" ? [record({ setup: { phase: "failed", log: failedLog, exitCode: 1, error: "Post-create hook exited with 1" } })] : [],
  get: async () => ({ worktree: record(), info: info() }),
  land: async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return scenario === "conflict"
      ? { kind: "conflict", files: ["src/auth/LoginForm.tsx", "src/auth/LoginForm.test.tsx", "src/client/src/components/very/deeply/nested/path/SessionInboxPanel.ts"], defaultBranch: "main", prompt: "Rebase onto main and resolve the conflicts." }
      : { kind: "landed", sha: "7e3c9a1f20b4", cleanup: { kind: "done" } };
  },
  discardPreview: async () => ({ worktreeId: "wt1", branch, defaultBranch: "main", confirmationToken: "tok", dirtyFiles: ["src/auth/LoginForm.tsx", "notes.md"],
    commits: [
      { sha: "a1b2c3d4e5", subject: "Refuse an empty password on submit" },
      { sha: "b2c3d4e5f6", subject: "Say why the form refused the password" },
      { sha: "c3d4e5f6a7", subject: "Add LoginForm regression tests for empty, whitespace, and valid passwords" },
      { sha: "d4e5f6a7b8", subject: "Lint" },
    ] }),
  discard: async () => ({ kind: "discarded", cleanup: { kind: "done" } }),
};

let emitWorktree: WorktreeListener = () => {};
const newApi: NewSessionApi = {
  projects: async () => projects,
  workspaces: async (id) => workspaces[id] ?? [{ id: `${id}-main`, path: projects.find((item) => item.id === id)!.path, label: "main", isMain: true }],
  models: async () => ({ models, model: models[0], thinkingLevel: "high" }),
  promptResources: async () => [],
  start: async (_cwd, _first, _choice, options) => {
    const token = options?.startupToken;
    emitWorktree(record({ startupToken: token }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    emitWorktree(record({ startupToken: token, setup: { phase: "hook", log: hookLog } }));
    if (scenario === "new-hook") return new Promise(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    emitWorktree(record({ startupToken: token, setup: { phase: "failed", log: failedLog, exitCode: 1, error: "Post-create hook exited with 1" } }));
    return { type: "failed", failure: { stage: "start", message: "Post-create hook exited with 1", maybeStarted: true } };
  },
};
const launches = createLaunchStore<LaunchDraft>(newApi, { onWorktree: (listener) => { emitWorktree = listener; return () => {}; } });

function typeAndSend(text: string) {
  const input = document.querySelector<ComposerInputElement>(".ns-dialog [data-composer-input]");
  if (!input) return;
  input.focus();
  input.value = text;
  setTimeout(() => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ctrlKey: true })), 100);
}

function NewSessionPreview() {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(transcript, false), onNew: async () => {} });
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (scenario === "new-hook") timers.push(setTimeout(() => typeAndSend("Fix the empty-password login and add a regression test."), 500));
    if (scenario === "new-picker") {
      timers.push(setTimeout(() => document.querySelector<HTMLButtonElement>(".destination-trigger")?.click(), 400));
      timers.push(setTimeout(() => document.querySelector<HTMLButtonElement>('[data-project="p1"]')?.click(), 800));
    }
    if (scenario === "new-failed") timers.push(setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>(".ns-tray button")].find((node) => node.textContent === "View setup")?.click(), 600));
    return () => timers.forEach(clearTimeout);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Fix the empty-password login" status="Connected"><Thread /></SessionFrame>
    <NewSession cwd={`${repo}/.worktree/new-ui-mvp`} api={newApi} worktrees={worktreeApi} launches={launches} deferred={createDeferredFiles()}
      onStarted={() => {}} onClose={() => {}} />
  </AssistantRuntimeProvider>;
}

/** The open session: branch chip on the bar, the session menu, and the Land and Discard windows. */
function SessionPreview() {
  const done = scenario === "landed" || scenario === "discarded";
  const worktree = scenario === "landed" ? info({ state: { kind: "landed", sha: "7e3c9a1f20b4", at: "t" }, ahead: undefined, dirtyFiles: undefined })
    : scenario === "discarded" ? info({ state: { kind: "discarded", at: "t" }, ahead: undefined, dirtyFiles: undefined }) : info();
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(transcript, false), onNew: async () => {} });
  const [command, setCommand] = useState<WorktreeCommand | undefined>(scenario === "land" || scenario === "conflict" ? "land" : scenario === "discard" ? "discard" : undefined);
  const [open, setOpen] = useState(scenario === "picker" || scenario === "response-picker" || scenario === "archive-note");
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (scenario === "session-menu") timers.push(setTimeout(() => document.querySelector<HTMLButtonElement>('[aria-label="Session menu"]')?.click(), 400));
    if (scenario === "conflict") timers.push(setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>(".wt-foot button")].find((node) => node.textContent?.startsWith("Land"))?.click(), 500));
    return () => timers.forEach(clearTimeout);
  }, []);
  const now = Date.parse("2026-10-06T21:30:00Z");
  const sessions = [
    { id: "s1", cwd: worktree.path, name: "Fix the empty-password login", modified: "2026-10-06T21:20:00Z", worktree,
      ...(scenario === "response-picker" ? { response: { kind: "needs-response" as const, reason: "undeclared" as const } } : {}) },
    { id: "s2", cwd: `${repo}/.worktree/s-01a115`, name: "Land the picker redesign", modified: "2026-10-06T21:10:00Z",
      ...(scenario === "response-picker" ? { response: { kind: "needs-response" as const, reason: "reply" as const } } : {}),
      worktree: info({ id: "wt2", branch: "picker-redesign", state: { kind: "landed", sha: "c0ffee1234", at: "t" }, ahead: undefined, dirtyFiles: undefined }) },
    { id: "s3", cwd: `${repo}/.worktree/s-01a116`, name: "Try a darker sidebar", modified: "2026-10-06T20:50:00Z",
      worktree: info({ id: "wt3", branch: "darker-sidebar", state: { kind: "discarded", at: "t" }, ahead: undefined, dirtyFiles: undefined }) },
    { id: "s4", cwd: `${repo}/.worktree/s-01a117`, name: "Speed up session listing on a busy machine with long names", modified: "2026-10-06T21:25:00Z",
      worktree: info({ id: "wt4", branch: "speed-up-session-listing-on-a-busy-machine", ahead: 12, dirtyFiles: 37 }) },
    { id: "s5", cwd: repo, name: "Review upstream", modified: "2026-10-06T19:00:00Z",
      ...(scenario === "response-picker" ? { response: { kind: "needs-response" as const, reason: "undeclared" as const } } : {}) },
  ];
  const all = boardRows({ sessions, statuses: {}, activities: { s4: { phase: "active", activeSince: "2026-10-06T21:22:00Z" } }, unread: new Set(["s1"]), now,
    locate: createLocationResolver([{ id: "p1", name: "forgerie", path: repo }], []) });
  const toast = scenario === "archive-note" ? { type: "undo" as const, target: { id: "s1", cwd: worktree.path, name: "Fix the empty-password login" },
    note: `Kept worktree ${branch}: it has commits that are not on main. Land or discard it to remove it.` } : undefined;
  return <AssistantRuntimeProvider runtime={runtime}>
    <ToastRegion />
    {toast ? <PickerToast toast={toast} onUndo={() => {}} onDismiss={() => {}} /> : null}
    <AppShell open={open} onOpenChange={setOpen}
      picker={(layout) => <Picker view={{ connection: { type: "ready" }, machines: 1, selectedId: "s1", archivedCount: 0, toast,
        sections: boardSections(all, { grouping: "state", showArchived: false, now, selectedId: "s1" }) }}
        prefs={{ grouping: "state", showArchived: false, collapsed: DEFAULT_COLLAPSED, allPinned: false }} onPrefs={() => {}}
        actions={{ onSelect: () => {}, onRetry: () => {}, onNew: () => {}, onUndo: () => {}, onDismissToast: () => {},
          onClose: layout === "overlay" ? () => setOpen(false) : undefined }} />}
      thread={<SessionFrame name="Fix the empty-password login" status={done ? (scenario === "landed" ? "Landed" : "Discarded") : "Connected"}
        actions={<>
          <TreeOpener idle onOpen={() => {}} />
          <ArchiveNextButton availability={{ type: "ready" }} onArchive={() => {}} />
          {!done && <SessionMenu info={worktree} busy={false} onCommand={setCommand} />}
        </>}>
        <Thread
          head={scenario === "session-setup" ? <WorktreeSetupCard setup={{ phase: "hook", log: hookLog }} hookSeen branch={branch} /> : undefined}
          inputContext={done ? undefined : <WorktreeChip info={worktree} />}
          readOnly={done ? <WorktreeReceipt state={worktree.state} defaultBranch="main" branch={branch} onNew={() => {}} /> : undefined}
          model={{ model: models[0], thinkingLevel: "high", disabled: false, listModels: async () => models, listThinkingLevels: async () => ["high"],
            onModel: async () => {}, onThinkingLevel: async () => {} }} />
      </SessionFrame>} />
    {command && <WorktreeDialog command={command} info={worktree} api={worktreeApi} onAsk={async () => {}} onDone={() => {}} onClose={() => setCommand(undefined)} />}
  </AssistantRuntimeProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(scenario.startsWith("new") ? <NewSessionPreview /> : <SessionPreview />);
