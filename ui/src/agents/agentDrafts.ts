/**
 * Unsaved agent edits, in this browser only. A draft outlives a switch to a
 * session, a reload, a fold, and a rotation; saving or discarding clears it.
 * It remembers the file version it started from, so a save over a newer file
 * is refused by the server rather than silently winning.
 */
export interface AgentDraft {
  /** The file's mtime when editing began; null for a file that does not exist yet. */
  baseMtimeMs: number | null;
  /** The file text editing began from. */
  baseText: string;
  text: string;
  /** For a new agent: the file name, chosen at first save. */
  file?: string | undefined;
}

const PREFIX = "forgerie.agentDraft.";

export const agentDrafts = {
  read(key: string): AgentDraft | undefined {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) as AgentDraft : undefined;
    } catch { return undefined; }
  },
  write(key: string, draft: AgentDraft) {
    try {
      if (draft.text === draft.baseText) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(draft));
    } catch { /* A full or blocked store loses only the draft, never the file. */ }
  },
  clear(key: string) { try { localStorage.removeItem(PREFIX + key); } catch { /* see write */ } },
  has(key: string) { try { return localStorage.getItem(PREFIX + key) !== null; } catch { return false; } },
};
