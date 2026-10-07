import { z } from "zod";
import type { AskDrafts } from "./askDraft";
import { diffNoteSchema, NOTE_LIMITS, type DiffNote } from "./changes/diffNotes";

/**
 * Unsent text the user typed, kept in this browser so a session switch or a
 * reload does not lose it. The daemon owns "an ask is open"; the browser owns
 * "what I typed so far". Attachments are not kept: they are files, not text.
 * Notes on diff lines are kept: they are text the user wrote for the next message.
 *
 * Storage holds drafts as plain text on this device. Two pages that edit the
 * same field of one session's draft follow last-writer-wins.
 */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One ask's unsent answers: the question on screen, and each question's draft. */
export interface AskProgress { index: number; drafts: AskDrafts }

export interface SessionDrafts {
  chat(): string;
  saveChat(text: string): void;
  /** The saved answers, only if they belong to `askId`. */
  answers(askId: string): AskProgress | undefined;
  saveAnswers(askId: string, progress: AskProgress): void;
  /** Drop saved answers of any ask other than the open one. `undefined` means no ask is open. */
  keepAnswers(askId: string | undefined): void;
  /** Notes on diff lines that wait for the next message. */
  notes(): DiffNote[];
  saveNotes(notes: readonly DiffNote[]): void;
}
export interface DraftStore {
  session(id: string): SessionDrafts;
  /** The session is deleted: drop its drafts and ignore later writes from this page. */
  forget(id: string): void;
}

const PREFIX = "forgerie.draft.v1:";
const questionDraftSchema = z.object({ values: z.array(z.string()), text: z.string() });
const askSchema = z.object({ id: z.string(), index: z.number().int().nonnegative(), drafts: z.record(z.string(), questionDraftSchema) });
const notesSchema = z.array(diffNoteSchema).max(NOTE_LIMITS.notes);
interface DraftRecord { chat: string; ask?: z.infer<typeof askSchema>; notes?: DiffNote[] }

function without(record: DraftRecord, field: "ask" | "notes"): DraftRecord {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

/** The browser's storage, if this page may use it. Only the composition root reads the global. */
export function browserStorage(): DraftStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function createDraftStore(storage: DraftStorage | undefined): DraftStore {
  const forgotten = new Set<string>();
  const key = (id: string) => `${PREFIX}${id}`;

  function read(id: string): DraftRecord {
    let raw: unknown;
    try { raw = JSON.parse(storage?.getItem(key(id)) ?? "null"); } catch { return { chat: "" }; }
    if (typeof raw !== "object" || raw === null) return { chat: "" };
    const fields = raw as Record<string, unknown>;
    // Each field is checked on its own, so a damaged answer set never costs the chat draft.
    const chat = z.string().safeParse(fields["chat"]);
    const ask = askSchema.safeParse(fields["ask"]);
    const notes = notesSchema.safeParse(fields["notes"]);
    return { chat: chat.success ? chat.data : "", ...(ask.success ? { ask: ask.data } : {}),
      ...(notes.success && notes.data.length > 0 ? { notes: notes.data } : {}) };
  }
  /** Read, change, and write one session's record, so fields another page wrote survive. */
  function update(id: string, change: (record: DraftRecord) => DraftRecord) {
    if (forgotten.has(id)) return;
    const next = change(read(id));
    try {
      if (next.chat === "" && !next.ask && !next.notes?.length) storage?.removeItem(key(id));
      else storage?.setItem(key(id), JSON.stringify(next));
    } catch { /* Full or blocked storage: the draft then lasts for this page only. */ }
  }

  return {
    session: (id) => ({
      chat: () => read(id).chat,
      saveChat: (text) => update(id, (record) => ({ ...record, chat: text })),
      answers: (askId) => {
        const ask = read(id).ask;
        return ask?.id === askId ? { index: ask.index, drafts: ask.drafts } : undefined;
      },
      saveAnswers: (askId, progress) => update(id, (record) => {
        const rest = without(record, "ask");
        const drafts = Object.fromEntries(Object.entries(progress.drafts)
          .filter(([, draft]) => draft.values.length > 0 || draft.text !== "")
          .map(([question, draft]) => [question, { values: [...draft.values], text: draft.text }]));
        const blank = Object.keys(drafts).length === 0 && progress.index === 0;
        return blank ? rest : { ...rest, ask: { id: askId, index: progress.index, drafts } };
      }),
      keepAnswers: (askId) => {
        const ask = read(id).ask;
        if (ask && ask.id !== askId) update(id, (record) => without(record, "ask"));
      },
      notes: () => read(id).notes ?? [],
      saveNotes: (notes) => update(id, (record) => notes.length > 0 ? { ...record, notes: [...notes] } : without(record, "notes")),
    }),
    forget: (id) => {
      forgotten.add(id);
      try { storage?.removeItem(key(id)); } catch { /* Blocked storage holds nothing to remove. */ }
    },
  };
}
