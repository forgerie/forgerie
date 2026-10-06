// Runs row commands against the catalog and owns the one message line under
// the list: the undo offer after an archive, a copy confirmation, or a refusal.
import { MutationError, type SessionRef } from "./catalogStore";
import type { RowCommandKind } from "./commands";

/** The writes a row command needs. The catalog store provides them. */
export interface SessionWrites {
  setPinned: (ref: SessionRef, pinned: boolean) => Promise<void>;
  setArchived: (ref: SessionRef, archived: boolean) => Promise<void>;
  deleteArchived: (ref: SessionRef) => Promise<void>;
}
export interface Target extends SessionRef { name?: string | undefined }
export type Toast =
  | { type: "undo"; target: Target }
  | { type: "info"; text: string }
  | { type: "error"; text: string };
export interface RowActionsState {
  toast?: Toast | undefined;
  /** Sessions with a write in flight. A second command on one is ignored. */
  pending: ReadonlySet<string>;
}
interface Timers { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void }

/** How long the undo offer stays (inventory 6.2). */
export const UNDO_MS = 5000;
const INFO_MS = 2500;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const titleOf = (target: Target) => target.name ?? "Untitled session";

export function createRowActions(deps: {
  writes: SessionWrites;
  /** Resolves true when the text reached the clipboard. */
  copy: (text: string) => Promise<boolean>;
  /** Called after a session is deleted, so the owner can close it if it was open. */
  onDeleted?: (id: string) => void;
  timers?: Timers;
}) {
  const timers: Timers = deps.timers ?? { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let state: RowActionsState = { pending: new Set() };
  let toastTimer: unknown;
  const listeners = new Set<() => void>();
  const update = (next: RowActionsState) => { state = next; for (const listener of listeners) listener(); };
  const show = (toast: Toast | undefined) => {
    timers.clear(toastTimer);
    toastTimer = undefined;
    // Errors stay until dismissed or replaced: a refusal read after it vanished is no help.
    if (toast && toast.type !== "error") toastTimer = timers.set(() => update({ ...state, toast: undefined }), toast.type === "undo" ? UNDO_MS : INFO_MS);
    update({ ...state, toast });
  };
  const setPending = (id: string, on: boolean) => {
    const pending = new Set(state.pending);
    if (on) pending.add(id); else pending.delete(id);
    update({ ...state, pending });
  };
  async function guarded(target: Target, write: () => Promise<void>): Promise<boolean> {
    if (state.pending.has(target.id)) return false;
    setPending(target.id, true);
    try { await write(); return true; }
    catch (error) { show({ type: "error", text: messageOf(error) }); return false; }
    finally { setPending(target.id, false); }
  }

  /** Archive with the undo offer. True once the server confirms; false after a refusal or a duplicate. */
  async function archive(target: Target): Promise<boolean> {
    // A second archive replaces the first offer; the first archive stands.
    const done = await guarded(target, () => deps.writes.setArchived({ id: target.id, cwd: target.cwd }, true));
    if (done) show({ type: "undo", target });
    return done;
  }

  return {
    getSnapshot: () => state,
    archive,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async run(kind: RowCommandKind, target: Target): Promise<void> {
      const ref = { id: target.id, cwd: target.cwd };
      switch (kind) {
        case "pin": case "unpin":
          await guarded(target, () => deps.writes.setPinned(ref, kind === "pin"));
          return;
        case "archive":
          await archive(target);
          return;
        case "restore":
          if (await guarded(target, () => deps.writes.setArchived(ref, false))) show({ type: "info", text: `Restored ${titleOf(target)}` });
          return;
        case "delete":
          if (await guarded(target, () => deps.writes.deleteArchived(ref))) {
            show({ type: "info", text: `Deleted ${titleOf(target)}` });
            deps.onDeleted?.(target.id);
          }
          return;
        case "copyPath":
          show(await deps.copy(target.cwd).catch(() => false)
            ? { type: "info", text: "Copied workspace path" }
            // The clipboard can refuse (plain HTTP, permissions). Give the path so it can be copied by hand.
            : { type: "error", text: `Could not copy. The path is ${target.cwd}` });
          return;
      }
    },
    async undo(): Promise<void> {
      const toast = state.toast;
      if (toast?.type !== "undo") return;
      show(undefined);
      try { await deps.writes.setArchived(toast.target, false); }
      catch (error) {
        show({ type: "error", text: error instanceof MutationError && error.status === 404 ? "Session was already deleted" : messageOf(error) });
      }
    },
    dismiss: () => show(undefined),
    dispose: () => { timers.clear(toastTimer); listeners.clear(); },
  };
}
export type RowActions = ReturnType<typeof createRowActions>;
