import type { SessionDrafts } from "../draftStore";
import type { DiffNote } from "./diffNotes";

/**
 * The notes waiting for the next message of one session. The review adds and
 * edits them; the message box shows them; a sent message drops the ones it
 * carried. Notes added while a message is in flight stay for the next one.
 */
export interface NoteTray {
  notes(): readonly DiffNote[];
  subscribe(listener: () => void): () => void;
  add(note: DiffNote): void;
  edit(id: string, comment: string): void;
  remove(id: string): void;
  /** Drop notes a message delivered, by id. */
  drop(ids: readonly string[]): void;
}

export function createNoteTray(saved?: Pick<SessionDrafts, "notes" | "saveNotes">): NoteTray {
  let notes: readonly DiffNote[] = saved?.notes() ?? [];
  const listeners = new Set<() => void>();
  const set = (next: readonly DiffNote[]) => {
    notes = next;
    saved?.saveNotes(next);
    for (const listener of listeners) listener();
  };
  return {
    notes: () => notes,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    add: (note) => set([...notes, note]),
    edit: (id, comment) => set(notes.map((note) => note.id === id ? { ...note, comment } : note)),
    remove: (id) => set(notes.filter((note) => note.id !== id)),
    drop: (ids) => { if (ids.length > 0) set(notes.filter((note) => !ids.includes(note.id))); },
  };
}
