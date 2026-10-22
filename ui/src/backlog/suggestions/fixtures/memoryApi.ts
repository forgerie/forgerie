// The suggestion routes in memory, for previews and tests: each press answers after `delayMs`, as the server would,
// and later reads return the answered records. A refusal set for an id answers that id's next press instead.
import { SuggestionRefusal, type ActRequest, type Suggestion, type SuggestionsApi } from "../suggestionsApi";
import { answer } from "./serverLike";

export interface MemoryServer {
  api: SuggestionsApi;
  records: () => readonly Suggestion[];
  /** Every press the routes took, in order, with the body that matters. */
  presses: { id: string; kind: string; request: ActRequest }[];
  refuse: (id: string, refusal: { status: number; message: string }) => void;
}

export function memoryServer(initial: readonly Suggestion[], delayMs = 0): MemoryServer {
  let list = [...initial];
  const presses: MemoryServer["presses"] = [];
  const refusals = new Map<string, { status: number; message: string }>();
  const later = <T,>(value: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => { try { resolve(value()); } catch (error) { reject(error); } }, delayMs));
  const press = (id: string, kind: Parameters<typeof answer>[1], request: ActRequest = {}) => {
    presses.push({ id, kind, request });
    return later(() => {
      const refusal = refusals.get(id);
      if (refusal) { refusals.delete(id); throw new SuggestionRefusal(refusal.message, refusal.status === 409 ? "conflict" : "unavailable", refusal.status); }
      const record = list.find((entry) => entry.id === id);
      if (!record) throw new SuggestionRefusal("No such suggestion.", "not-found", 404);
      const next = answer(record, kind, request);
      list = list.map((entry) => entry.id === id ? next : entry);
      return next;
    });
  };
  return {
    api: {
      list: (query) => later(() => list.filter((entry) => query.sessionId === undefined || entry.sessionId === query.sessionId)),
      file: (id, request) => press(id, "file", request),
      fileAndAct: (id, request) => press(id, "file-and-act", request),
      dismiss: (id) => press(id, "dismiss"),
      restore: (id) => press(id, "restore"),
    },
    records: () => list,
    presses,
    refuse: (id, refusal) => { refusals.set(id, refusal); },
  };
}
