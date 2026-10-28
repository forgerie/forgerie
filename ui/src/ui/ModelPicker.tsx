import { usePortalTarget } from "./portalLayer";
import type { ContextUse } from "../contextUse";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import type { SessionModel } from "../contracts";
import { hiddenModelsLabel, modelKey, modelLabel, modelMenu, modelOptionGroups, thinkingLabel } from "../modelChoice";
import { cycleTarget, resolveFavorites } from "../models/modelPrefs";
import { useModelPrefs } from "../models/modelPrefsApi";
import { usePanelPlacement } from "./usePanelPlacement";
import { FloatingPanel } from "./FloatingPanel";
import { OptionList, type OptionGroup, type OptionListHandle, type OptionStatus } from "./OptionList";

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
  /** A level that means "no level of its own", such as one inherited: listed first, pressed while no level is set, never drawn on the trigger. */
  unsetLevel?: { id: string; label: string } | undefined;
  /** Named choices that stand for more than one model, such as model chains: their own group, above the models. */
  choices?: ModelPickerChoices | undefined;
}
/** A group of named choices in the model panel. A choice's `detail` says what it stands for, such as the models in it. */
export interface ModelPickerChoices {
  label: string;
  options: readonly { id: string; name: string; detail?: string | undefined }[];
  /** The choice in effect, when the value is one of these rather than a model. Its name shows on the trigger. */
  current?: string | undefined;
  onChoose: (id: string) => Promise<void>;
}
export interface PickerOpen { query: string }

type Load<T> = { type: "loading" } | { type: "ready"; value: T } | { type: "failed"; message: string };
type Change = { type: "idle" } | { type: "changing"; target: string } | { type: "failed"; message: string };
const PANEL_CAP = 416;
/** Option ids of named choices. A model's id is `provider/id`, so the two never meet. */
const CHOICE_PREFIX = "choice:";
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
export function ModelPicker({ binding, anchor, open, onOpenChange, minWidthRem, word, wordIcon, look, returnFocus, bare = false }: {
  binding: ModelBinding; anchor: RefObject<HTMLElement | null>;
  /** Takes focus back when the panel closes, for a trigger its host has hidden, such as one moved into a More menu. */
  returnFocus?: (() => void) | undefined;
  /** Only the panel, for a host that opens it from elsewhere, such as a menu row. `returnFocus` takes focus back. */
  bare?: boolean;
  /** Draw the trigger as this one word, such as Change, inside a sentence that already names the model. */
  word?: string | undefined;
  /** A mark before the word, such as a plus on an action that adds a model. */
  wordIcon?: ReactNode;
  /** `value`: the trigger is the value of a row, such as one entry of a list, and reads in the text colour. */
  look?: "value" | undefined;
  open: PickerOpen | undefined; onOpenChange: (open: PickerOpen | undefined) => void;
  /** The panel's least width, for an anchor narrower than a usable panel, such as a trigger alone in a row. */
  minWidthRem?: number | undefined;
}) {
  const layer = usePortalTarget();
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Held here, not in the panel: a change keeps the panel open until Pi answers,
  // so its result and its error always land in the panel that sent it.
  const [change, setChange] = useState<Change>({ type: "idle" });
  const changing = change.type === "changing";
  const chosen = binding.model === undefined ? binding.choices?.current : undefined;
  const label = binding.model ? modelLabel(binding.model) : chosen ?? binding.emptyLabel ?? modelLabel(undefined);
  const level = binding.model || chosen ? binding.thinkingLevel : undefined;
  const close = useCallback((giveBack: boolean) => {
    setChange((current) => current.type === "failed" ? { type: "idle" } : current);
    onOpenChange(undefined);
    if (!giveBack) return;
    if (returnFocus) returnFocus();
    else trigger.current?.focus({ preventScroll: true });
  }, [onOpenChange, returnFocus]);
  const cycled = useFavoriteCycle(binding, open !== undefined, change, setChange, onOpenChange);
  return <>
    {binding.cycle && <span className="sr-only" role="status">{cycled}</span>}
    {!bare && <button ref={trigger} type="button" className="model-trigger" disabled={binding.disabled}
      aria-haspopup="dialog" aria-expanded={open !== undefined} aria-controls={open ? panelId : undefined}
      aria-label={`${label}${level ? ` ${thinkingLabel(level)}` : ""}, change model and thinking level`}
      title="Model and thinking level" data-look={word === undefined ? look : "word"} onClick={() => { if (!changing) onOpenChange(open ? undefined : { query: "" }); }}>
      {word === undefined ? <>
        <span className="model-trigger-name">{label}</span>
        {level && <span className="model-trigger-level">{thinkingLabel(level)}</span>}
        <ChevronDownIcon aria-hidden size={14} />
      </> : <>{wordIcon}<span className="model-trigger-name">{word}</span></>}
    </button>}
    {open && createPortal(<ModelPanel id={panelId} binding={binding} anchor={anchor} trigger={trigger} minWidthRem={minWidthRem}
      initialQuery={open.query} onClose={close} change={change} setChange={setChange} />, layer)}
  </>;
}

function ModelPanel({ id, binding, anchor, trigger, minWidthRem, initialQuery, onClose, change, setChange }: {
  id: string; binding: ModelBinding; anchor: RefObject<HTMLElement | null>; trigger: RefObject<HTMLButtonElement | null>; minWidthRem: number | undefined;
  initialQuery: string; onClose: (returnFocus: boolean) => void;
  change: Change; setChange: (change: Change) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<OptionListHandle>(null);
  const [query, setQuery] = useState(initialQuery);
  const activeKey = binding.model ? modelKey(binding.model) : undefined;
  const choices = binding.choices;
  const models = useLoad(binding.listModels, "models");
  // Each model allows its own levels, so they are read again after a change.
  const levels = useLoad(binding.listThinkingLevels, activeKey ?? (choices?.current === undefined ? "none" : `${CHOICE_PREFIX}${choices.current}`));
  const prefs = useModelPrefs();
  const [showHidden, setShowHidden] = useState(false);
  const menu = useMemo(() => models.type === "ready" ? modelMenu(models.value, query, { prefs, showHidden, activeKey }) : { groups: [], hidden: 0 },
    [models, query, prefs, showHidden, activeKey]);
  const { groups } = menu;
  const busy = change.type === "changing" || binding.disabled;
  const changingRef = useRef(false);
  changingRef.current = change.type === "changing";

  usePanelPlacement(panel, anchor, PANEL_CAP, minWidthRem);

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
    if (initialQuery !== "") panel.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
  }, [initialQuery]);
  const rowFocused = useRef(false);
  useEffect(() => {
    if (rowFocused.current || initialQuery !== "" || models.type !== "ready") return;
    rowFocused.current = true;
    if (document.activeElement === panel.current) list.current?.focus();
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
    if (busy || level === (binding.thinkingLevel ?? binding.unsetLevel?.id)) return;
    setChange({ type: "changing", target: `level:${level}` });
    try { await binding.onThinkingLevel(level); setChange({ type: "idle" }); }
    catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  async function pickChoice(id: string) {
    if (busy || !choices) return;
    if (id === choices.current && binding.model === undefined) { onClose(true); return; }
    setChange({ type: "changing", target: `${CHOICE_PREFIX}${id}` });
    try {
      await choices.onChoose(id);
      setChange({ type: "idle" });
      if (panel.current?.isConnected) onClose(true);
    } catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!changingRef.current) onClose(true); }
  }

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const choiceGroup: OptionGroup | undefined = choices && models.type === "ready" ? { key: CHOICE_PREFIX, label: choices.label, options: choices.options
    .filter((option) => needle === "" || option.name.toLowerCase().includes(needle) || option.detail?.toLowerCase().includes(needle))
    .map((option) => ({ id: `${CHOICE_PREFIX}${option.id}`, name: option.name, details: option.detail ? [option.detail] : undefined,
      current: binding.model === undefined && option.id === choices.current, blocked: busy,
      busy: change.type === "changing" && change.target === `${CHOICE_PREFIX}${option.id}` })) } : undefined;
  const status: OptionStatus | undefined = models.type === "loading" ? { tone: "status", text: "Loading models…" }
    : models.type === "failed" ? { tone: "alert", text: `Models unavailable: ${models.message}` }
    : groups.length > 0 || (choiceGroup?.options.length ?? 0) > 0 ? undefined
    : { tone: "status", text: menu.hidden > 0 ? (trimmed ? `No shown model matches "${trimmed}".` : "Every model is hidden.")
      : trimmed ? `No model matches "${trimmed}".` : "Pi offers no models for this session." };
  const modelOptions = modelOptionGroups(groups, { activeKey, changing: change.type === "changing" ? change.target : undefined, blocked: busy });
  const options = choiceGroup && choiceGroup.options.length > 0 ? [choiceGroup, ...modelOptions] : modelOptions;
  const unset = binding.unsetLevel;
  const levelChoices = levels.type === "ready" ? (unset ? [unset.id, ...levels.value.filter((item) => item !== unset.id)] : levels.value) : [];
  const levelInEffect = binding.thinkingLevel ?? unset?.id;
  return <FloatingPanel ref={panel} id={id} role="dialog" aria-label="Model and thinking level" tabIndex={-1} onKeyDown={onKeyDown}>
    {/* The list keeps its search and a row or more; when the levels need the rest of a short panel, the panel scrolls. */}
    <div className="model-list"><OptionList ref={list} label="Models" groups={options} status={status}
      search={{ value: query, onChange: setQuery, label: "Search models", placeholder: "Search models" }}
      alert={change.type === "failed" ? change.message : undefined}
      action={models.type === "ready" && (menu.hidden > 0 || showHidden) ? { label: hiddenModelsLabel(menu.hidden, showHidden), pressed: showHidden,
        icon: showHidden ? <EyeOffIcon aria-hidden size={14} /> : <EyeIcon aria-hidden size={14} />, onPress: () => setShowHidden(!showHidden) } : undefined}
      input={{ type: "focus", onChoose: (key) => {
        if (key.startsWith(CHOICE_PREFIX)) { void pickChoice(key.slice(CHOICE_PREFIX.length)); return; }
        const model = models.type === "ready" ? models.value.find((item) => modelKey(item) === key) : undefined;
        if (model?.provider && model.id) void pickModel(model.provider, model.id);
      } }} /></div>
    {binding.thinking !== false && <div className="model-thinking" role="group" aria-labelledby={`${id}-thinking`}>
      <span id={`${id}-thinking`} className="model-thinking-label">Thinking</span>
      {levels.type === "loading" && <span className="model-hint" role="status">Loading…</span>}
      {levels.type === "failed" && <span className="model-hint" role="alert">Levels unavailable: {levels.message}</span>}
      {levels.type === "ready" && levelChoices.length <= 1 && <span className="model-hint">This model does not think.</span>}
      {levelChoices.length > 1 && <div className="model-levels">
        {levelChoices.map((item) => <button key={item} type="button" aria-pressed={item === levelInEffect}
          aria-disabled={busy && item !== levelInEffect || undefined} onClick={() => void pickLevel(item)}>{item === unset?.id ? unset.label : thinkingLabel(item)}</button>)}
      </div>}
    </div>}
  </FloatingPanel>;
}
