import { usePortalTarget } from "./portalLayer";
import type { ContextUse } from "../contextUse";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import type { SessionModel } from "../contracts";
import { modelKey, modelLabel, modelMenu, thinkingLabel } from "../modelChoice";
import { cycleTarget, resolveFavorites } from "../models/modelPrefs";
import { useModelPrefs } from "../models/modelPrefsApi";
import { usePanelPlacement } from "./usePanelPlacement";
import "./modelMenu.css";

/**
 * What the picker shows and changes. The binding owns where the choice lives:
 * a running session's Pi status, or a session that does not exist yet.
 */
export interface ModelBinding {
  model?: SessionModel | undefined;
  thinkingLevel?: string | undefined;
  disabled: boolean;
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  /** The levels the current model allows. */
  listThinkingLevels: (signal: AbortSignal) => Promise<string[]>;
  onModel: (provider: string, id: string) => Promise<void>;
  onThinkingLevel: (level: string) => Promise<void>;
  /** How full the context window is. The composer draws it as a bar on its top edge. */
  context?: ContextUse | undefined;
  /** False for a choice that has no thinking level of its own, such as a fallback model. */
  thinking?: boolean | undefined;
  /** The trigger's words when no model is set. */
  emptyLabel?: string | undefined;
  /** Ctrl+P and Shift+Ctrl+P switch between favorites, as in Pi. Set only where one picker owns the page. */
  cycle?: boolean | undefined;
}
export interface PickerOpen { query: string }

type Load<T> = { type: "loading" } | { type: "ready"; value: T } | { type: "failed"; message: string };
type Change = { type: "idle" } | { type: "changing"; target: string } | { type: "failed"; message: string };
const PANEL_CAP = 416;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Reads that restart when their key changes and stop when the panel closes. */
function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Load<T> {
  const [state, setState] = useState<{ key: string; load: Load<T> }>({ key, load: { type: "loading" } });
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, load: { type: "loading" } });
    latest.current(controller.signal).then((value) => { if (!controller.signal.aborted) setState({ key, load: { type: "ready", value } }); },
      (error: unknown) => { if (!controller.signal.aborted) setState({ key, load: { type: "failed", message: messageOf(error) } }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.load : { type: "loading" };
}

const isCycleKey = (event: globalThis.KeyboardEvent) => event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "p";

/**
 * Ctrl+P moves to the next favorite and Shift+Ctrl+P to the one before, as in
 * Pi. A favorite stored with a thinking level (`provider/id:high`) sets that
 * level too. The key is taken from the browser's print command only while the
 * binding asks for it. Returns words for screen readers about the last move.
 */
function useFavoriteCycle(binding: ModelBinding, panelOpen: boolean, change: Change, setChange: (change: Change) => void,
  onOpenChange: (open: PickerOpen | undefined) => void): string {
  const prefs = useModelPrefs(binding.cycle === true);
  const [said, setSaid] = useState("");
  const latest = useRef({ binding, prefs, panelOpen, change });
  latest.current = { binding, prefs, panelOpen, change };
  // One read of the session's models serves a burst of presses.
  const models = useRef<{ at: number; list: Promise<SessionModel[]> } | undefined>(undefined);
  useEffect(() => {
    if (!binding.cycle) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isCycleKey(event)) return;
      event.preventDefault();
      const { binding: current, prefs: lists, panelOpen: open, change: state } = latest.current;
      if (current.disabled || state.type === "changing" || !lists || lists.favorites.length === 0) return;
      const direction = event.shiftKey ? -1 : 1;
      const fail = (error: unknown) => { setChange({ type: "failed", message: messageOf(error) }); if (!open) onOpenChange({ query: "" }); };
      void (async () => {
        if (!models.current || Date.now() - models.current.at > 60_000) models.current = { at: Date.now(), list: current.listModels(new AbortController().signal) };
        let list: SessionModel[];
        try { list = await models.current.list; } catch (error) { models.current = undefined; fail(error); return; }
        const target = cycleTarget(resolveFavorites(lists.favorites, list), current.model ? modelKey(current.model) : undefined, direction);
        if (!target) return;
        setChange({ type: "changing", target: target.key });
        try {
          await current.onModel(target.provider, target.id);
          if (target.level && current.thinking !== false) await current.onThinkingLevel(target.level);
          setChange({ type: "idle" });
          setSaid(`Model: ${modelLabel(list.find((model) => modelKey(model) === target.key))}${target.level ? `, ${thinkingLabel(target.level)}` : ""}`);
        } catch (error) { fail(error); }
      })();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [binding.cycle, setChange, onOpenChange]);
  return said;
}

/**
 * System molecule: the session's model and thinking level, after assistant-ui's
 * model selector element. The trigger is a readout in the input bar; the panel
 * opens at window level so the transcript cannot clip it. Nothing changes in
 * the browser until Pi answers, and a change is never retried.
 */
export function ModelPicker({ binding, anchor, open, onOpenChange }: {
  binding: ModelBinding; anchor: RefObject<HTMLElement | null>;
  open: PickerOpen | undefined; onOpenChange: (open: PickerOpen | undefined) => void;
}) {
  const layer = usePortalTarget();
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Held here, not in the panel: a change keeps the panel open until Pi answers,
  // so its result and its error always land in the panel that sent it.
  const [change, setChange] = useState<Change>({ type: "idle" });
  const changing = change.type === "changing";
  const label = binding.model ? modelLabel(binding.model) : binding.emptyLabel ?? modelLabel(undefined);
  const level = binding.model ? binding.thinkingLevel : undefined;
  const close = useCallback((returnFocus: boolean) => {
    setChange((current) => current.type === "failed" ? { type: "idle" } : current);
    onOpenChange(undefined);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, [onOpenChange]);
  const cycled = useFavoriteCycle(binding, open !== undefined, change, setChange, onOpenChange);
  return <>
    {binding.cycle && <span className="sr-only" role="status">{cycled}</span>}
    <button ref={trigger} type="button" className="model-trigger" disabled={binding.disabled}
      aria-haspopup="dialog" aria-expanded={open !== undefined} aria-controls={open ? panelId : undefined}
      aria-label={`${label}${level ? ` ${thinkingLabel(level)}` : ""}, change model and thinking level`}
      title="Model and thinking level" onClick={() => { if (!changing) onOpenChange(open ? undefined : { query: "" }); }}>
      <span className="model-trigger-name">{label}</span>
      {level && <span className="model-trigger-level">{thinkingLabel(level)}</span>}
      <ChevronDownIcon aria-hidden size={14} />
    </button>
    {open && createPortal(<ModelPanel id={panelId} binding={binding} anchor={anchor} trigger={trigger}
      initialQuery={open.query} onClose={close} change={change} setChange={setChange} />, layer)}
  </>;
}

function ModelPanel({ id, binding, anchor, trigger, initialQuery, onClose, change, setChange }: {
  id: string; binding: ModelBinding; anchor: RefObject<HTMLElement | null>; trigger: RefObject<HTMLButtonElement | null>;
  initialQuery: string; onClose: (returnFocus: boolean) => void;
  change: Change; setChange: (change: Change) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const activeKey = binding.model ? modelKey(binding.model) : undefined;
  const models = useLoad(binding.listModels, "models");
  // Each model allows its own levels, so they are read again after a change.
  const levels = useLoad(binding.listThinkingLevels, activeKey ?? "none");
  const prefs = useModelPrefs();
  const [showHidden, setShowHidden] = useState(false);
  const menu = useMemo(() => models.type === "ready" ? modelMenu(models.value, query, { prefs, showHidden, activeKey }) : { groups: [], hidden: 0 },
    [models, query, prefs, showHidden, activeKey]);
  const { groups } = menu;
  const busy = change.type === "changing" || binding.disabled;
  const changingRef = useRef(false);
  changingRef.current = change.type === "changing";

  usePanelPlacement(panel, anchor, PANEL_CAP);

  // A tap outside closes the panel. The trigger toggles it itself.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (changingRef.current) return;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose, trigger]);

  // Search text from `/model` goes to the search box. Otherwise the panel
  // itself takes focus at once, so Escape works while the models load and no
  // touch keyboard opens. The active row takes over once the list is there.
  useLayoutEffect(() => {
    if (initialQuery !== "") search.current?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
  }, [initialQuery]);
  const rowFocused = useRef(false);
  useEffect(() => {
    if (rowFocused.current || initialQuery !== "" || models.type !== "ready") return;
    rowFocused.current = true;
    if (document.activeElement !== panel.current) return;
    const active = panel.current?.querySelector<HTMLButtonElement>(".model-row[aria-current='true']")
      ?? panel.current?.querySelector<HTMLButtonElement>(".model-row");
    active?.focus({ preventScroll: false });
  }, [initialQuery, models.type]);

  async function pickModel(provider: string, modelId: string) {
    if (busy) return;
    if (`${provider}/${modelId}` === activeKey) { onClose(true); return; }
    setChange({ type: "changing", target: `${provider}/${modelId}` });
    try {
      await binding.onModel(provider, modelId);
      setChange({ type: "idle" });
      if (panel.current?.isConnected) onClose(true);
    } catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  async function pickLevel(level: string) {
    if (busy || level === binding.thinkingLevel) return;
    setChange({ type: "changing", target: `level:${level}` });
    try { await binding.onThinkingLevel(level); setChange({ type: "idle" }); }
    catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!changingRef.current) onClose(true); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".model-row") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  }

  const levelChoices = levels.type === "ready" ? levels.value : [];
  return <div ref={panel} id={id} className="model-panel" role="dialog" aria-label="Model and thinking level" tabIndex={-1} onKeyDown={onKeyDown}>
    <input ref={search} type="search" className="model-search" placeholder="Search models" aria-label="Search models"
      value={query} onChange={(event) => setQuery(event.target.value)} enterKeyHint="search" />
    {change.type === "failed" && <p className="model-error" role="alert">{change.message}</p>}
    <div className="model-list">
      {models.type === "loading" && <p className="model-hint" role="status">Loading models…</p>}
      {models.type === "failed" && <p className="model-hint" role="alert">Models unavailable: {models.message}</p>}
      {models.type === "ready" && groups.length === 0 && <p className="model-hint" role="status">
        {menu.hidden > 0 ? (query.trim() ? `No shown model matches "${query.trim()}".` : "Every model is hidden.")
          : query.trim() ? `No model matches "${query.trim()}".` : "Pi offers no models for this session."}
      </p>}
      {groups.map((group) => <section key={group.key} className="model-group" aria-labelledby={`${id}-${group.key}`}>
        <h3 className="model-group-label" id={`${id}-${group.key}`}>{group.label}</h3>
        <ul>{group.rows.map((row) => {
          const active = row.key === activeKey;
          const changing = change.type === "changing" && change.target === row.key;
          return <li key={row.key}>
            <button type="button" className="model-row" aria-current={active || undefined} data-plain={row.plain || undefined} data-hidden={row.hidden || undefined}
              aria-disabled={busy && !active || undefined} aria-busy={changing || undefined} onClick={() => void pickModel(row.provider, row.id)}>
              <span className="model-row-name">{row.label}{row.variant && <span className="model-row-variant">{row.variant}</span>}</span>
              <span className="model-row-meta">
                {row.isDefault && <span className="model-row-default">default</span>}
                {row.providerName && <span>{row.providerName}</span>}
                {row.context && <span>{row.context} context</span>}
                {row.plain && <span>no thinking</span>}
                {row.hidden && <span>hidden</span>}
                {changing && <span>Switching…</span>}
              </span>
              {active && <CheckIcon aria-hidden size={16} className="model-row-check" />}
            </button>
          </li>;
        })}</ul>
      </section>)}
      {models.type === "ready" && (menu.hidden > 0 || showHidden) && <button type="button" className="model-hidden-toggle" aria-pressed={showHidden}
        onClick={() => setShowHidden(!showHidden)}>
        {showHidden ? <EyeOffIcon aria-hidden size={14} /> : <EyeIcon aria-hidden size={14} />}
        {showHidden ? "Hide models you do not show" : `Show ${String(menu.hidden)} hidden ${menu.hidden === 1 ? "model" : "models"}`}
      </button>}
    </div>
    {binding.thinking !== false && <div className="model-thinking" role="group" aria-labelledby={`${id}-thinking`}>
      <span id={`${id}-thinking`} className="model-thinking-label">Thinking</span>
      {levels.type === "loading" && <span className="model-hint" role="status">Loading…</span>}
      {levels.type === "failed" && <span className="model-hint" role="alert">Levels unavailable: {levels.message}</span>}
      {levels.type === "ready" && levelChoices.length <= 1 && <span className="model-hint">This model does not think.</span>}
      {levelChoices.length > 1 && <div className="model-levels">
        {levelChoices.map((item) => <button key={item} type="button" aria-pressed={item === binding.thinkingLevel}
          aria-disabled={busy && item !== binding.thinkingLevel || undefined} onClick={() => void pickLevel(item)}>{thinkingLabel(item)}</button>)}
      </div>}
    </div>}
  </div>;
}
