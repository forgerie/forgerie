// Backlog suggestions as the server last said, and what the reader is doing to them. The server's record is the
// truth: a card draws its state from here, never from the transcript, so a reload shows the last outcome. The
// binding calls refresh() on `backlog.suggestions.changed`, on reconnect, and when a card names a record it lacks.
import { SuggestionRefusal, type ActRequest, type Suggestion, type SuggestionModel, type SuggestionsApi } from "./suggestionsApi";
import { canFile, edited, isFiled, matchNumbers, matchPaths, type SuggestionAction, type SuggestionDraft } from "./suggestionsModel";

export type SuggestionPress = SuggestionAction | "dismiss" | "restore";
export interface SuggestionsView {
  /** Undefined until the first read answers. A failed reread keeps the last list. */
  suggestions: readonly Suggestion[] | undefined;
  readError?: string | undefined;
  /** A read is on its way. */
  reading: boolean;
  /** The press in flight for a record. Its buttons wait until it answers. */
  pending: Readonly<Record<string, SuggestionPress>>;
  /** Why the last press on a record did not go through. */
  problems: Readonly<Record<string, string>>;
  /** The reader's title and body, kept here so they outlive the card and a resize. */
  drafts: Readonly<Record<string, SuggestionDraft>>;
  /** The model this launch uses, when the reader changed it. */
  models: Readonly<Record<string, SuggestionModel>>;
  /** The last action pressed, so Retry repeats it. */
  last: Readonly<Record<string, SuggestionAction>>;
}

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * `query` says which records this store holds: one chat's, or every chat's open ones.
 * Undefined means there is nothing to read yet, such as a session with no id.
 */
export function createSuggestionsStore(api: SuggestionsApi, query: () => { sessionId?: string | undefined; state?: string | undefined } | undefined) {
  let view: SuggestionsView = { suggestions: undefined, reading: false, pending: {}, problems: {}, drafts: {}, models: {}, last: {} };
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  let reads = 0;
  /** Ids a card asked for that the last read lacked, so one missing id costs one read. */
  const asked = new Set<string>();
  /** Called when a record turns filed or started, from a press or a read, so whoever lists the backlog reads it again. */
  const filedListeners = new Set<(records: readonly Suggestion[]) => void>();
  const set = (next: SuggestionsView) => {
    const before = new Map(view.suggestions?.map((suggestion) => [suggestion.id, suggestion.state.kind]));
    view = next;
    const moved = (next.suggestions ?? []).filter((suggestion) => (suggestion.state.kind === "filed" || suggestion.state.kind === "started")
      && before.has(suggestion.id) && before.get(suggestion.id) !== suggestion.state.kind);
    for (const listener of listeners) listener();
    if (moved.length) for (const listener of filedListeners) listener(moved);
  };
  const update = (change: (current: SuggestionsView) => SuggestionsView) => { if (!lifetime.signal.aborted) set(change(view)); };

  async function refresh() {
    const scope = query();
    if (scope === undefined || lifetime.signal.aborted) return;
    const read = ++reads;
    update((current) => current.reading ? current : { ...current, reading: true });
    try {
      const suggestions = await api.list(scope, lifetime.signal);
      // A later read answers for the later state; this one is stale.
      if (read !== reads) return;
      update((current) => ({ ...current, suggestions: merge(current.suggestions, suggestions), readError: undefined, reading: false }));
    } catch (error) {
      if (read !== reads || lifetime.signal.aborted) return;
      update((current) => ({ ...current, readError: message(error), reading: false }));
    }
  }
  /** A newer revision wins, so a list read that raced a press never takes the press's answer back. */
  function merge(current: readonly Suggestion[] | undefined, next: readonly Suggestion[]): readonly Suggestion[] {
    const known = new Map(current?.map((suggestion) => [suggestion.id, suggestion]));
    return next.map((suggestion) => {
      const mine = known.get(suggestion.id);
      return mine !== undefined && mine.revision > suggestion.revision ? mine : suggestion;
    });
  }
  function accept(record: Suggestion) {
    update((current) => {
      const list = current.suggestions ?? [];
      const has = list.some((suggestion) => suggestion.id === record.id);
      return { ...current, suggestions: has ? list.map((suggestion) => suggestion.id === record.id && suggestion.revision <= record.revision ? record : suggestion) : [record, ...list] };
    });
  }
  /** Holds a record's buttons for a press. False when a press on it is already in flight. */
  function mark(id: string, kind: SuggestionPress): boolean {
    if (view.pending[id] !== undefined) return false;
    update((current) => ({ ...current, pending: { ...current.pending, [id]: kind }, problems: without(current.problems, id),
      ...(kind === "file" || kind === "file-and-act" ? { last: { ...current.last, [id]: kind } } : {}) }));
    return true;
  }
  /** Sends a marked press. The record the server returned, or undefined when it refused. */
  async function run(id: string, send: () => Promise<Suggestion>, after?: (record: Suggestion) => void): Promise<Suggestion | undefined> {
    try {
      const record = await send();
      accept(record);
      after?.(record);
      return record;
    } catch (error) {
      update((current) => ({ ...current, problems: { ...current.problems, [id]: message(error) } }));
      // The record moved on elsewhere, such as in another window: read where it is now.
      if (error instanceof SuggestionRefusal && error.status === 409) void refresh();
      return undefined;
    } finally {
      update((current) => ({ ...current, pending: without(current.pending, id) }));
    }
  }
  const press = (id: string, kind: SuggestionPress, send: () => Promise<Suggestion>, after?: (record: Suggestion) => void) =>
    mark(id, kind) ? run(id, send, after) : Promise.resolve(undefined);
  /**
   * One press for several records. Every record's buttons wait at once; the requests go one at a time, in the order
   * given, so filings and launches never race each other in the repository. A refusal stops only its own record.
   */
  async function pressAll(ids: readonly string[], kind: SuggestionPress, send: (id: string) => Promise<Suggestion>, after?: (record: Suggestion) => void) {
    const marked = ids.filter((id) => mark(id, kind));
    const records: Suggestion[] = [];
    for (const id of marked) {
      const record = await run(id, () => send(id), after);
      if (record !== undefined) records.push(record);
    }
    return records;
  }
  const find = (id: string) => view.suggestions?.find((suggestion) => suggestion.id === id);
  /** The words and match numbers a file request carries for this record. */
  function request(id: string): ActRequest {
    const record = find(id);
    const draft = view.drafts[id];
    const words = record !== undefined && edited(record, draft) && draft !== undefined ? { title: draft.title.trim(), body: draft.body.trim() } : {};
    // File anyway names the matches shown: GitHub issues by number, Markdown files by path.
    const numbers = record?.destination.provider === "github" ? matchNumbers(record.state) : [];
    const paths = record?.destination.provider === "markdown" ? matchPaths(record.state) : [];
    return { ...words, ...(numbers.length ? { notDuplicateOf: numbers } : {}), ...(paths.length ? { acknowledgedPaths: paths } : {}) };
  }
  /**
   * A filed record no longer has words to edit or a model to pick. One whose launch failed keeps its model: the server
   * retries the launch with the choice it recorded, and a server older than that record takes this one again.
   */
  const fileOne = (id: string) => api.file(id, request(id));
  const actOne = (id: string) => {
    const model = view.models[id];
    return api.fileAndAct(id, { ...request(id), ...(model?.modelSpec ? { modelSpec: model.modelSpec } : {}), ...(model?.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}) });
  };
  const settle = (record: Suggestion) => {
    if (canFile(record.state)) return;
    const launchFailed = record.state.kind === "filed" && record.state.launchError !== undefined;
    update((current) => ({ ...current, drafts: without(current.drafts, record.id), ...(launchFailed ? {} : { models: without(current.models, record.id) }) }));
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => view,
    refresh,
    onFiled: (listener: (records: readonly Suggestion[]) => void) => { filedListeners.add(listener); return () => { filedListeners.delete(listener); }; },
    /** A card shows a record this store lacks: read once more, since the agent may have just made it. */
    want: (id: string) => {
      if (view.suggestions === undefined || find(id) !== undefined || asked.has(id)) return;
      asked.add(id);
      void refresh();
    },
    file: (id: string) => press(id, "file", () => fileOne(id), settle),
    /** Files and starts a background session; from a filed record, only starts it. Never moves the reader. */
    fileAndAct: (id: string) => press(id, "file-and-act", () => actOne(id), settle),
    /** Files each record, one at a time. Resolves with the records the server filed. */
    fileAll: (ids: readonly string[]) => pressAll(ids, "file", fileOne, settle),
    /**
     * Files each record and starts a background session for it, one at a time. With `model`, every launch uses it,
     * as a pick from the model panel would for one record.
     */
    fileAndActAll: (ids: readonly string[], model?: SuggestionModel) => {
      if (model !== undefined) update((current) => ({ ...current, models: { ...current.models, ...Object.fromEntries(ids.map((id) => [id, model])) } }));
      return pressAll(ids, "file-and-act", actOne, settle);
    },
    /**
     * File and act here: files each record, then hands the filed ones, in the order given, to `deliver`, which asks this
     * chat's agent to work on them. Nothing is delivered when none was filed.
     */
    fileHere: async (ids: readonly string[], deliver: (records: readonly Suggestion[]) => Promise<void>) => {
      const filed = (await pressAll(ids, "file", fileOne, settle)).filter((record) => isFiled(record.state));
      if (filed.length > 0) await deliver(filed);
      return filed;
    },
    dismiss: (id: string) => press(id, "dismiss", () => api.dismiss(id)),
    restore: (id: string) => press(id, "restore", () => api.restore(id)),
    setDraft: (id: string, draft: SuggestionDraft | undefined) => update((current) => ({ ...current,
      drafts: draft === undefined ? without(current.drafts, id) : { ...current.drafts, [id]: draft } })),
    setModel: (id: string, model: SuggestionModel | undefined) => update((current) => ({ ...current,
      models: model === undefined ? without(current.models, id) : { ...current.models, [id]: model } })),
    /** Whether a card already asked for this id, so a read that still lacks it means the record is not there. */
    asked: (id: string) => asked.has(id),
    dismissProblem: (id: string) => update((current) => ({ ...current, problems: without(current.problems, id) })),
    dispose: () => { lifetime.abort(); listeners.clear(); filedListeners.clear(); },
  };
}
export type SuggestionsStore = ReturnType<typeof createSuggestionsStore>;
