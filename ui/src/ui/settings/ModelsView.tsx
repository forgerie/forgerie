import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";
import { modelsResponseSchema, type SessionModel } from "../../contracts";
import { compactContextWindow, modelLabel, providerLabel } from "../../modelChoice";
import { applyChange, keyOf, parseFavorite, resolveFavorites, splitKey, THINKING_LEVELS, type Lists, type ModelPrefs, type ModelPrefsSave, type PrefsChange } from "../../models/modelPrefs";
import { thinkingLevelsFor } from "../../newSession";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ModelPicker";
import { SettingsField } from "./SettingsField";
import { liveModelPrefs, ModelPrefsContext, PrefsConflict } from "../../models/modelPrefsApi";
import { tildify } from "./PluginsView";
import { SettingsFrame } from "./SettingsFrame";
import { SettingsToggle } from "./SettingsToggle";
import "./settings.css";
import "./models.css";

type Model = SessionModel & { provider: string; id: string };
type Load = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; prefs: ModelPrefs; models: Model[] };
type Phase = { type: "idle" } | { type: "saving" } | { type: "saved" } | { type: "failed"; message: string; conflict: boolean };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const listsOf = (prefs: ModelPrefs): Lists => ({ favorites: prefs.favorites, visible: prefs.visible, defaultModel: prefs.defaultModel, defaultThinkingLevel: prefs.defaultThinkingLevel });
const sameLists = (a: Lists, b: Lists) => JSON.stringify([a.favorites, a.visible, a.defaultModel ?? null, a.defaultThinkingLevel ?? null])
  === JSON.stringify([b.favorites, b.visible, b.defaultModel ?? null, b.defaultThinkingLevel ?? null]);
const isLevel = (level: string | null | undefined): level is ModelPrefsSave["defaultThinkingLevel"] & string => (THINKING_LEVELS as readonly unknown[]).includes(level);
/** A save sends the defaults only when they changed, so a value Pi wrote that this page does not know survives. */
function saveOf(revision: string, want: Lists, held: ModelPrefs): ModelPrefsSave {
  return { revision, favorites: want.favorites, visible: want.visible,
    ...(want.defaultModel && want.defaultModel !== held.defaultModel ? { defaultModel: want.defaultModel } : {}),
    ...(isLevel(want.defaultThinkingLevel) && want.defaultThinkingLevel !== held.defaultThinkingLevel ? { defaultThinkingLevel: want.defaultThinkingLevel } : {}) };
}

/**
 * Where a new session starts, by the server's rule: Pi's default when a
 * signed-in provider offers it and, with favorites, when it is one of them;
 * otherwise the first favorite, otherwise the first model.
 */
export function startModel(lists: Lists, models: readonly Model[]): { model: Model | undefined; reason: "default" | "unset" | "unavailable" | "notFavorite" } {
  const favorites = resolveFavorites(lists.favorites, models).flatMap((favorite) => models.find((model) => keyOf(model) === favorite.key) ?? []);
  const fallback = favorites[0] ?? models[0];
  if (!lists.defaultModel) return { model: fallback, reason: "unset" };
  const chosen = models.find((model) => keyOf(model) === lists.defaultModel);
  if (!chosen) return { model: fallback, reason: "unavailable" };
  if (favorites.length > 0 && !favorites.includes(chosen)) return { model: fallback, reason: "notFavorite" };
  return { model: chosen, reason: "default" };
}

/** The models a session started in `home` may use: Pi's catalogue, less providers without credentials. */
export async function availableModels(home: string, signal?: AbortSignal): Promise<Model[]> {
  const response = await fetch(`/api/models?${new URLSearchParams({ cwd: home })}`, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Forgerie answered ${String(response.status)} for the model list.`);
  return modelsResponseSchema.parse(await response.json()).models.filter((model): model is Model => !!model.provider && !!model.id);
}

function matches(model: Model, needle: string) {
  return needle === "" || [model.provider, model.id, model.name, providerLabel(model.provider)].some((field) => field?.toLowerCase().includes(needle));
}

/**
 * Binding: the app's model lists. Each tap saves at once, as Plugins does.
 * Taps made while a save runs are kept and saved next, so a burst of changes
 * is never lost and never sent out of order.
 */
export function ModelsView({ onBack, onClose, listModels = availableModels }: {
  onBack: () => void; onClose?: (() => void) | undefined;
  listModels?: (home: string, signal?: AbortSignal) => Promise<Model[]>;
}) {
  const source = useContext(ModelPrefsContext) ?? liveModelPrefs;
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [lists, setLists] = useState<Lists>();
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [query, setQuery] = useState("");
  // The save loop's own view: what the server holds, and what the page wants.
  const saved = useRef<ModelPrefs | undefined>(undefined);
  const wanted = useRef<Lists | undefined>(undefined);
  const saving = useRef(false);

  const read = useCallback(async (signal?: AbortSignal) => {
    try {
      const prefs = await source.read(signal);
      const models = await listModels(prefs.home, signal);
      if (signal?.aborted) return;
      saved.current = prefs;
      wanted.current = undefined;
      setLists(listsOf(prefs));
      setLoad({ type: "ready", prefs, models });
      setPhase({ type: "idle" });
    } catch (error) {
      if (!signal?.aborted) setLoad((current) => current.type === "ready" ? current : { type: "failed", message: errorText(error) });
      if (!signal?.aborted) setPhase((current) => current.type === "idle" ? current : { type: "failed", message: errorText(error), conflict: false });
    }
  }, [source, listModels]);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  async function flush() {
    if (saving.current) return;
    saving.current = true;
    setPhase({ type: "saving" });
    try {
      while (wanted.current && saved.current && !sameLists(wanted.current, saved.current)) {
        saved.current = await source.save(saveOf(saved.current.revision, wanted.current, saved.current));
      }
      setPhase({ type: "saved" });
    } catch (error) {
      setPhase({ type: "failed", message: errorText(error), conflict: error instanceof PrefsConflict });
    } finally { saving.current = false; }
  }
  const models = load.type === "ready" ? load.models : [];
  function change(next: PrefsChange) {
    if (!lists || phase.type === "failed") return;
    const after = applyChange(wanted.current ?? lists, next, models);
    wanted.current = after;
    setLists(after);
    void flush();
  }

  const view = useMemo(() => {
    if (!lists) return undefined;
    const favorites = resolveFavorites(lists.favorites, models);
    const favoriteKeys = new Set(favorites.map((favorite) => favorite.key));
    const shown = (key: string) => lists.visible === null || favoriteKeys.has(key) || lists.visible.includes(key);
    const needle = query.trim().toLowerCase();
    const favoriteModels = favorites.flatMap((favorite) => models.find((model) => keyOf(model) === favorite.key) ?? []);
    const providers: { provider: string; models: Model[] }[] = [];
    for (const model of models) {
      if (favoriteKeys.has(keyOf(model))) continue;
      const group = providers.find((entry) => entry.provider === model.provider);
      if (group) group.models.push(model); else providers.push({ provider: model.provider, models: [model] });
    }
    // Entries Pi keeps that name no model here: globs, and models no provider offers now.
    const kept = lists.favorites.filter((raw) => parseFavorite(raw).pattern || !favorites.some((favorite) => favorite.raw === raw));
    return {
      shown, favoriteKeys, kept,
      favorites: favoriteModels.filter((model) => matches(model, needle)),
      providers: providers.map((group) => ({ ...group, models: group.models.filter((model) => matches(model, needle)) })).filter((group) => group.models.length > 0),
      count: models.filter((model) => shown(keyOf(model))).length,
    };
  }, [lists, models, query]);

  const busy = phase.type === "saving";
  const status = busy ? "Saving…" : phase.type === "saved" ? "Saved" : undefined;
  const back = <button type="button" className="settings-back" onClick={onBack}><ChevronLeftIcon aria-hidden size={16} />Settings</button>;
  const close = onClose ? <button type="button" className="picker-icon" aria-label="Close settings" title="Close settings" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null;
  const failure = load.type === "failed" ? `Could not read the model lists: ${load.message}` : phase.type === "failed" ? phase.message : undefined;
  const home = load.type === "ready" ? load.prefs.home : "";

  return <SettingsFrame back={back} title="Models" status={status} actions={close} error={failure}
    recovery={<button type="button" onClick={() => { setPhase({ type: "idle" }); void read(); }}>{phase.type === "failed" ? "Reload lists" : "Retry"}</button>}>
    <p className="settings-lede">New sessions start on the default model. The model menu offers the models you show here. Favorites come first in it, and Ctrl+P switches between them. These settings apply to every session.</p>
    {load.type === "loading" ? <p className="settings-hint" role="status">Reading models…</p> : null}
    {load.type === "ready" && view && lists ? <>
      <DefaultModel lists={lists} models={models} locked={phase.type === "failed"} onChange={change} />
      <div className="models-summary">
        <p>{lists.visible === null
          ? <>Every model is shown. Hide one, and from then on the menu offers only the models you show. Models a provider adds later stay hidden too.</>
          : <>{view.count} of {models.length} models shown. Models a provider adds later stay hidden until you show them.</>}</p>
        {lists.visible !== null ? <button type="button" className="agent-text-button" disabled={phase.type === "failed"}
          onClick={() => change({ type: "show", keys: models.map(keyOf), on: true })}>Show every model</button> : null}
      </div>
      <label className="models-search">
        <SearchIcon aria-hidden size={16} />
        <input type="search" placeholder="Search models" aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} enterKeyHint="search" />
      </label>
      <section className="agent-group" aria-labelledby="models-favorites">
        <h2 id="models-favorites" className="agent-group-label">Favorites</h2>
        {view.favorites.length === 0
          ? <p className="settings-hint plugin-empty">{query.trim() ? "No favorite matches." : "No favorites yet. Star the models you switch between most."}</p>
          : <ul className="agent-list">{view.favorites.map((model) => <ModelPrefRow key={keyOf(model)} model={model} favorite shown
            isDefault={keyOf(model) === lists.defaultModel} locked={phase.type === "failed"} onChange={change} />)}</ul>}
        {view.kept.length > 0 && !query.trim() ? <p className="agent-group-where">Pi also keeps {view.kept.map((raw, index) => <span key={raw}>{index > 0 ? ", " : ""}<code>{raw}</code></span>)}.
          These name no model here, so this page leaves them as they are.</p> : null}
      </section>
      {view.providers.map((group) => {
        const keys = group.models.map(keyOf);
        const allShown = keys.every((key) => view.shown(key));
        const label = providerLabel(group.provider);
        return <section key={group.provider} className="agent-group" aria-label={label}>
          <div className="models-group-head">
            <h2 className="agent-group-label">{label}</h2>
            <button type="button" className="agent-text-button" disabled={phase.type === "failed"}
              onClick={() => change({ type: "show", keys, on: !allShown })}>{allShown ? (query.trim() ? "Hide these" : "Hide all") : (query.trim() ? "Show these" : "Show all")}</button>
          </div>
          <ul className="agent-list">{group.models.map((model) => <ModelPrefRow key={keyOf(model)} model={model} favorite={false} shown={view.shown(keyOf(model))}
            isDefault={keyOf(model) === lists.defaultModel} locked={phase.type === "failed"} onChange={change} />)}</ul>
        </section>;
      })}
      {query.trim() && view.favorites.length === 0 && view.providers.length === 0 ? <p className="settings-hint">No model matches "{query.trim()}".</p> : null}
      <p className="agent-group-where models-where">The default model, its thinking level, and favorites are Pi's own settings, so terminal Pi with this profile uses them too. They are saved in <code>{tildify(load.prefs.favoritesPath, home)}</code>. Shown models are saved in <code>{tildify(load.prefs.visiblePath, home)}</code>.
        Only models whose provider is signed in appear here.</p>
    </> : null}
  </SettingsFrame>;
}

/**
 * Shape: Pi's default model and thinking level, in the model menu every
 * session uses. When the server would not start a session on the default,
 * the hint says on which model it starts instead, and how to fix it.
 */
function DefaultModel({ lists, models, locked, onChange }: {
  lists: Lists; models: readonly Model[]; locked: boolean; onChange: (change: PrefsChange) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<PickerOpen>();
  const split = lists.defaultModel ? splitKey(lists.defaultModel) : undefined;
  const chosen = models.find((model) => keyOf(model) === lists.defaultModel) ?? (split ? { ...split, name: lists.defaultModel ?? undefined } : undefined);
  const start = startModel(lists, models);
  const startName = start.model ? modelLabel(start.model) : "no model";
  const binding: ModelBinding = {
    model: chosen, thinkingLevel: lists.defaultThinkingLevel ?? undefined, disabled: locked, emptyLabel: "Choose a default",
    listModels: async () => [...models], listThinkingLevels: async () => thinkingLevelsFor(chosen),
    onModel: async (provider, id) => { onChange({ type: "default", key: `${provider}/${id}` }); },
    onThinkingLevel: async (level) => { onChange({ type: "defaultLevel", level }); },
  };
  const hint = start.reason === "unset" ? <>Pi has no default yet, so new sessions start on {startName}.</>
    : start.reason === "unavailable" ? <>No signed-in provider offers <code>{lists.defaultModel}</code>, so new sessions start on {startName}.</>
    : start.reason === "notFavorite" ? <>{modelLabel(chosen)} is not a favorite, so new sessions start on {startName}.{" "}
      <button type="button" className="agent-text-button" disabled={locked} onClick={() => { if (lists.defaultModel) onChange({ type: "favorite", key: lists.defaultModel, on: true }); }}>Add it to favorites</button></>
    : <>A favorite saved with its own level, such as <code>:high</code>, starts at that level instead.</>;
  return <div className="agent-properties models-default">
    <SettingsField label="Default model" hint={hint}>
      <div ref={anchor} className="agent-model"><ModelPicker binding={binding} anchor={anchor} open={open} onOpenChange={setOpen} /></div>
    </SettingsField>
  </div>;
}

/** Shape: one model with its two choices. The star and the switch keep their size; the name wraps. The default cannot be hidden or unstarred. */
function ModelPrefRow({ model, favorite, shown, isDefault, locked, onChange }: {
  model: Model; favorite: boolean; shown: boolean; isDefault: boolean; locked: boolean; onChange: (change: PrefsChange) => void;
}) {
  const key = keyOf(model);
  const name = modelLabel(model);
  const context = compactContextWindow(model.contextWindow);
  return <li className="model-pref" data-off={shown ? undefined : true}>
    <button type="button" className="model-pref-star" aria-pressed={favorite} disabled={locked || isDefault && favorite}
      aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
      title={isDefault && favorite ? "The default model stays a favorite. Choose another default first." : favorite ? "Remove from favorites" : "Add to favorites"}
      onClick={() => onChange({ type: "favorite", key, on: !favorite })}><StarIcon aria-hidden size={16} /></button>
    <span className="model-pref-name">{name}</span>
    <span className="model-pref-meta">
      {isDefault ? <span className="model-pref-default">Default</span> : null}
      <code>{key}</code>
      {context ? <span>{context} context</span> : null}
      {model.reasoning === false ? <span>no thinking</span> : null}
    </span>
    <span className="model-pref-switch"><SettingsToggle label={`Show ${name} in the model menu`} checked={shown} disabled={locked || isDefault && shown}
      onChange={(on) => onChange({ type: "show", keys: [key], on })} /></span>
  </li>;
}
