// Sessions this browser is starting. Owned by the app, not the new-session
// dialog: a Rapidfire start keeps going after the dialog closes, and the
// session list shows it before Pi has saved it.
import type { Session } from "./contracts";
import { newStartupToken, type AgentChoice, type FirstPrompt, type NewSessionApi, type StartFailure } from "./newSession";

export type LaunchState =
  /** `sessionId` once Pi has created the session; its files and first message still follow. */
  | { type: "starting"; progress?: string | undefined; sessionId?: string | undefined }
  | { type: "started"; session: Session }
  /** The session exists, but its first message may not have reached Pi. */
  | { type: "unsent"; session: Session; error: string }
  | { type: "failed"; error: string; maybeStarted: boolean };
/** `D` is the draft that comes back to the composer on a failure. */
export interface Launch<D> { id: string; cwd: string; title: string; startedAt: string; state: LaunchState; draft: D }
export type LaunchOutcome = Exclude<LaunchState, { type: "starting" }>;
export type StartupListener = (event: { startupToken?: string | undefined; activity: { phase: string; label: string; detail?: string | undefined } }) => void;

/** The first line, as a stand-in name until Pi names the session. */
export function launchTitle(text: string): string {
  const line = text.split("\n").find((item) => item.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "New session";
}

export function failureText(failure: StartFailure): string {
  if (failure.stage === "prompt") return `The session started, but its first message may not have reached Pi: ${failure.message} Check the transcript before you send it again.`;
  return failure.maybeStarted
    ? `${failure.message} The session may have started anyway. Check the session list before you try again.`
    : `The session did not start: ${failure.message}`;
}

export function createLaunchStore<D>(api: Pick<NewSessionApi, "start">, options: {
  onStartup?: ((listener: StartupListener) => () => void) | undefined; now?: () => Date;
} = {}) {
  let launches: readonly Launch<D>[] = [];
  const listeners = new Set<() => void>();
  const set = (next: readonly Launch<D>[]) => { launches = next; for (const listener of listeners) listener(); };
  const patch = (id: string, state: LaunchState) => set(launches.map((item) => item.id === id ? { ...item, state } : item));
  // One subscription for all starts; each event names its start by token.
  const stop = options.onStartup?.((event) => {
    const launch = launches.find((item) => item.id === event.startupToken);
    if (launch?.state.type !== "starting") return;
    const progress = event.activity.phase === "active" ? event.activity.label : undefined;
    if (progress !== launch.state.progress) patch(launch.id, { ...launch.state, progress });
  });
  return {
    getSnapshot: () => launches,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Start one session. Never retried: a step that may have worked is reported, not repeated. */
    launch(cwd: string, prompt: FirstPrompt, choice: AgentChoice, draft: D): { id: string; done: Promise<LaunchOutcome> } {
      const id = newStartupToken();
      set([...launches, { id, cwd, title: launchTitle(prompt.text), startedAt: (options.now?.() ?? new Date()).toISOString(), state: { type: "starting" }, draft }]);
      const created = (session: Session) => {
        const launch = launches.find((item) => item.id === id);
        if (launch?.state.type === "starting") patch(id, { ...launch.state, sessionId: session.id });
      };
      const done = api.start(cwd, prompt, choice, { startupToken: id, onCreated: created }).then((result): LaunchOutcome => {
        if (result.type === "started") return { type: "started", session: result.session };
        const { failure } = result;
        return failure.stage === "prompt" ? { type: "unsent", session: failure.session, error: failureText(failure) }
          : { type: "failed", error: failureText(failure), maybeStarted: failure.maybeStarted };
      }).then((outcome) => { if (launches.some((item) => item.id === id)) patch(id, outcome); return outcome; });
      return { id, done };
    },
    /** Take a launch out of the list, with its draft, to put the draft back in the composer. */
    take(id: string): Launch<D> | undefined {
      const launch = launches.find((item) => item.id === id);
      if (launch) set(launches.filter((item) => item !== launch));
      return launch;
    },
    dismiss(id: string) { set(launches.filter((item) => item.id !== id || item.state.type === "starting")); },
    dispose() { stop?.(); listeners.clear(); },
  };
}
export type LaunchStore<D> = ReturnType<typeof createLaunchStore<D>>;
