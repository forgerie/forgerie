// Sessions this browser is starting. Owned by the app, not the new-session
// dialog: a Rapidfire start keeps going after the dialog closes, and the
// session list shows it before Pi has saved it.
import type { Session } from "./contracts";
import { newStartupToken, type AgentChoice, type FirstPrompt, type NewSessionApi, type StartFailure } from "./newSession";
import type { NewSessionDestination, WorktreeRecord } from "./worktrees/worktreeApi";
import { POST_CREATE_HOOK } from "./worktrees/worktreeModel";
import type { BacklogClaim } from "./backlog/backlogApi";
import type { ItemRef } from "./backlog/backlogModel";

export type LaunchState =
  /** `sessionId` once Pi has created the session; its files and first message still follow. */
  | { type: "starting"; progress?: string | undefined; sessionId?: string | undefined }
  | { type: "started"; session: Session }
  /** The session exists, but its first message may not have reached Pi. */
  | { type: "unsent"; session: Session; error: string }
  /** `taken`: the backlog item went to another session first. Nothing started. */
  | { type: "failed"; error: string; maybeStarted: boolean; taken?: BacklogClaim | undefined };
/** `D` is the draft that comes back to the composer on a failure. */
export interface Launch<D> {
  id: string; cwd: string; title: string; startedAt: string; state: LaunchState; draft: D;
  prompt: FirstPrompt; choice: AgentChoice; placement: Placement;
  /** The fresh worktree this start set up, as the server last reported it. */
  worktree?: WorktreeRecord | undefined;
  /** The setup reached the post-create hook, so its step shows. */
  hookSeen?: boolean | undefined;
}
export type LaunchOutcome = Exclude<LaunchState, { type: "starting" }>;
export type StartupListener = (event: { startupToken?: string | undefined; activity: { phase: string; label: string; detail?: string | undefined } }) => void;
export type WorktreeListener = (record: WorktreeRecord) => void;
/** Where a start goes beyond its folder: a fresh worktree, or the folder itself, and a failed setup to retry. */
export interface Placement { ephemeral?: boolean | undefined; destination?: NewSessionDestination | undefined; setupId?: string | undefined;
  /** The backlog item the session takes. */
  item?: ItemRef | undefined;
  /** The stand-in name until Pi names the session. Absent: the first line. */
  title?: string | undefined }

/** The first line, as a stand-in name until Pi names the session. */
export function launchTitle(text: string): string {
  const line = text.split("\n").find((item) => item.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "New session";
}

export function failureText(failure: StartFailure): string {
  if (failure.stage === "start" && failure.taken) return "Another session took this item first, so this session did not start.";
  if (failure.stage === "prompt") return `The session started, but its first message may not have reached Pi: ${failure.message} Check the transcript before you send it again.`;
  return failure.maybeStarted
    ? `${failure.message} The session may have started anyway. Check the session list before you try again.`
    : `The session did not start: ${failure.message}`;
}

/** What a start is doing while its worktree is set up. Pi's own progress takes over once Pi starts. */
export function setupProgress(record: WorktreeRecord): string | undefined {
  switch (record.setup.phase) {
    case "creating": return "Creating worktree…";
    case "hook": return `Running ${POST_CREATE_HOOK}…`;
    default: return undefined;
  }
}
/** The progress line a worktree event leaves behind. Once Pi starts, its own events take over. */
function progressAfter(record: WorktreeRecord): string | undefined {
  switch (record.setup.phase) {
    case "creating": case "hook": return setupProgress(record);
    case "starting": return "Starting Pi…";
    default: return undefined;
  }
}

export function createLaunchStore<D>(api: Pick<NewSessionApi, "start">, options: {
  onStartup?: ((listener: StartupListener) => () => void) | undefined;
  onWorktree?: ((listener: WorktreeListener) => () => void) | undefined;
  /** Reads a start's worktree after a failure whose live events did not arrive. */
  findWorktree?: ((startupToken: string, cwd: string) => Promise<WorktreeRecord | undefined>) | undefined;
  setupDraft?: ((record: WorktreeRecord) => D) | undefined;
  now?: () => Date;
} = {}) {
  let launches: readonly Launch<D>[] = [];
  const listeners = new Set<() => void>();
  const set = (next: readonly Launch<D>[]) => { launches = next; for (const listener of listeners) listener(); };
  const change = (id: string, patch: Partial<Launch<D>>) => set(launches.map((item) => item.id === id ? { ...item, ...patch } : item));
  const patch = (id: string, state: LaunchState) => change(id, { state });
  // One subscription for all starts; each event names its start by token.
  const stopStartup = options.onStartup?.((event) => {
    const launch = launches.find((item) => item.id === event.startupToken);
    if (launch?.state.type !== "starting") return;
    // Pi's progress waits while the worktree is still being set up.
    if (launch.worktree && setupProgress(launch.worktree)) return;
    // The label ("Creating session") repeats the start button; the detail names the step.
    const progress = event.activity.phase === "active" ? event.activity.detail ?? event.activity.label : undefined;
    if (progress !== launch.state.progress) patch(launch.id, { ...launch.state, progress });
  });
  const stopWorktree = options.onWorktree?.((record) => {
    // A retried setup keeps its record id; a first setup is known by its token.
    const launch = launches.find((item) => item.id === record.startupToken)
      ?? launches.find((item) => item.worktree?.id === record.id && item.state.type === "starting");
    if (!launch) return;
    const hookSeen = launch.hookSeen === true || record.setup.phase === "hook" || record.setup.log !== "";
    const progress = progressAfter(record);
    change(launch.id, { worktree: record, hookSeen,
      ...(launch.state.type === "starting" && progress ? { state: { ...launch.state, progress } } : {}) });
  });
  const store = {
    getSnapshot: () => launches,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Start one session. Never automatically retried: a step that may have worked is reported, not repeated. */
    launch(cwd: string, prompt: FirstPrompt, choice: AgentChoice, draft: D, placement: Placement & { worktree?: WorktreeRecord | undefined } = {}): {
      id: string; done: Promise<LaunchOutcome>;
      /** The worktree this start set up, as last reported. Read it before taking the launch out of the list. */
      worktree: () => WorktreeRecord | undefined;
    } {
      const id = newStartupToken();
      const fresh = placement.destination?.kind === "fresh-worktree";
      set([...launches, { id, cwd, title: placement.title ?? launchTitle(prompt.text), startedAt: (options.now?.() ?? new Date()).toISOString(),
        state: { type: "starting", ...(fresh ? { progress: placement.setupId ? "Retrying worktree setup…" : "Creating worktree…" } : {}) }, draft, prompt, choice, placement,
        ...(placement.worktree ? { worktree: placement.worktree } : {}) }]);
      const created = (session: Session) => {
        const launch = launches.find((item) => item.id === id);
        if (launch?.state.type === "starting") patch(id, { ...launch.state, sessionId: session.id });
      };
      const done = api.start(cwd, prompt, choice, { startupToken: id, onCreated: created,
        ...(placement.ephemeral === true ? { ephemeral: true } : {}),
        ...(placement.destination ? { destination: placement.destination } : {}), ...(placement.setupId ? { setupId: placement.setupId } : {}),
        ...(placement.item ? { item: placement.item } : {}) })
        .then(async (result): Promise<LaunchOutcome> => {
          if (result.type === "started") return { type: "started", session: result.session };
          const { failure } = result;
          if (failure.stage === "prompt") return { type: "unsent", session: failure.session, error: failureText(failure) };
          // A failed setup proves Pi never started: the server starts Pi only after it.
          const setup = fresh ? await knownSetup(id, cwd) : undefined;
          if (setup?.setup.phase === "failed") {
            change(id, { worktree: setup, hookSeen: launches.find((item) => item.id === id)?.hookSeen === true || setup.setup.log !== "" });
            return { type: "failed", error: setupFailureText(setup), maybeStarted: false };
          }
          return { type: "failed", error: failureText(failure), maybeStarted: failure.maybeStarted, ...(failure.taken ? { taken: failure.taken } : {}) };
        }).then((outcome) => { if (launches.some((item) => item.id === id)) patch(id, outcome); return outcome; });
      return { id, done, worktree: () => launches.find((item) => item.id === id)?.worktree };
    },
    /** Recovery uses the original request and the same failed worktree, never a new worktree. */
    retrySetup(id: string) {
      const previous = launches.find((item) => item.id === id);
      if (previous?.state.type !== "failed" || previous.worktree?.setup.phase !== "failed") return undefined;
      const next = store.launch(previous.worktree.repo, previous.prompt, previous.choice, previous.draft,
        { ...previous.placement, destination: { kind: "fresh-worktree" }, setupId: previous.worktree.id, worktree: previous.worktree });
      store.take(id);
      return next;
    },
    forgetSetup(id: string) {
      const launch = launches.find((item) => item.id === id);
      if (launch?.state.type !== "failed") return;
      change(id, { worktree: undefined, placement: { ...launch.placement, setupId: undefined } });
    },
    /** A reload can recover a server-owned setup even though its browser draft is gone. */
    recoverSetup(record: WorktreeRecord) {
      if (!options.setupDraft || record.setup.phase !== "failed" || record.sessionId || record.state.kind !== "active"
        || launches.some((item) => item.worktree?.id === record.id || item.id === record.startupToken)) return;
      set([...launches, { id: record.startupToken ?? `setup-${record.id}`, cwd: record.repo, title: record.branch,
        startedAt: record.updatedAt ?? (options.now?.() ?? new Date()).toISOString(),
        state: { type: "failed", error: setupFailureText(record), maybeStarted: false },
        draft: options.setupDraft(record), prompt: { text: "" }, choice: {},
        placement: { destination: { kind: "fresh-worktree" }, setupId: record.id }, worktree: record, hookSeen: record.setup.log !== "" }]);
    },
    /** Take a launch out of the list, with its draft, to put the draft back in the composer. */
    take(id: string): Launch<D> | undefined {
      const launch = launches.find((item) => item.id === id);
      if (launch) set(launches.filter((item) => item !== launch));
      return launch;
    },
    dismiss(id: string) { set(launches.filter((item) => item.id !== id || item.state.type === "starting")); },
    dispose() { stopStartup?.(); stopWorktree?.(); listeners.clear(); },
  };
  return store;
  async function knownSetup(id: string, cwd: string): Promise<WorktreeRecord | undefined> {
    const live = launches.find((item) => item.id === id)?.worktree;
    if (live?.setup.phase === "failed") return live;
    try { return await options.findWorktree?.(id, cwd) ?? live; } catch { return live; }
  }
}
export type LaunchStore<D> = ReturnType<typeof createLaunchStore<D>>;

/** A failed setup, in one line. The card shows the log. */
export function setupFailureText(record: WorktreeRecord): string {
  const { setup } = record;
  if (setup.exitCode !== undefined) return `Worktree setup failed: ${POST_CREATE_HOOK} exited with ${String(setup.exitCode)}.`;
  return `Worktree setup failed${setup.error ? `: ${setup.error}` : "."}`;
}
