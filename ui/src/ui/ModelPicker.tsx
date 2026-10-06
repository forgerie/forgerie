import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { SessionModel } from "../contracts";
import { modelGroups, modelKey, modelLabel, thinkingLabel } from "../modelChoice";
import { mentionPlacement } from "../mentionSyntax";

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
    latest.current(controller.signal).then((value) => setState({ key, load: { type: "ready", value } }),
      (error: unknown) => { if (!controller.signal.aborted) setState({ key, load: { type: "failed", message: messageOf(error) } }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.load : { type: "loading" };
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
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = modelLabel(binding.model);
  const level = binding.model ? binding.thinkingLevel : undefined;
  const close = useCallback((returnFocus: boolean) => {
    onOpenChange(undefined);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, [onOpenChange]);
  return <>
    <button ref={trigger} type="button" className="model-trigger" disabled={binding.disabled}
      aria-haspopup="dialog" aria-expanded={open !== undefined} aria-controls={open ? panelId : undefined}
      aria-label={`Model and thinking level: ${label}${level ? `, thinking ${thinkingLabel(level)}` : ""}`}
      title="Model and thinking level" onClick={() => onOpenChange(open ? undefined : { query: "" })}>
      <span className="model-trigger-name">{label}</span>
      {level && <span className="model-trigger-level">{thinkingLabel(level)}</span>}
      <ChevronDownIcon aria-hidden size={14} />
    </button>
    {open && createPortal(<ModelPanel id={panelId} binding={binding} anchor={anchor} trigger={trigger}
      initialQuery={open.query} onClose={close} />, document.body)}
  </>;
}

function ModelPanel({ id, binding, anchor, trigger, initialQuery, onClose }: {
  id: string; binding: ModelBinding; anchor: RefObject<HTMLElement | null>; trigger: RefObject<HTMLButtonElement | null>;
  initialQuery: string; onClose: (returnFocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [change, setChange] = useState<Change>({ type: "idle" });
  const activeKey = binding.model ? modelKey(binding.model) : undefined;
  const models = useLoad(binding.listModels, "models");
  // Each model allows its own levels, so they are read again after a change.
  const levels = useLoad(binding.listThinkingLevels, activeKey ?? "none");
  const groups = useMemo(() => models.type === "ready" ? modelGroups(models.value, query) : [], [models, query]);
  const busy = change.type === "changing" || binding.disabled;

  useLayoutEffect(() => {
    const element = panel.current;
    const target = anchor.current;
    if (!element || !target) return;
    const viewport = window.visualViewport;
    const position = () => {
      const plan = mentionPlacement(target.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      }, PANEL_CAP);
      // Measured window geometry, not theme decisions.
      Object.assign(element.style, { left: `${plan.left}px`, top: `${plan.top}px`, width: `${plan.width}px`,
        maxHeight: `${plan.maxHeight}px`, transform: plan.up ? "translateY(-100%)" : "none" });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(target);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [anchor]);

  // A tap outside closes the panel. The trigger toggles it itself.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose, trigger]);

  // Search text from `/model` goes to the search box. Otherwise focus the
  // active row, so a touch keyboard does not open over the list.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    if (initialQuery !== "") { focused.current = true; search.current?.focus(); return; }
    if (models.type !== "ready") return;
    focused.current = true;
    const rows = panel.current?.querySelectorAll<HTMLButtonElement>(".model-row");
    const active = panel.current?.querySelector<HTMLButtonElement>(".model-row[aria-pressed='true']");
    (active ?? rows?.[0] ?? search.current)?.focus({ preventScroll: false });
  }, [initialQuery, models.type]);

  async function pickModel(provider: string, modelId: string) {
    if (busy) return;
    if (`${provider}/${modelId}` === activeKey) { onClose(true); return; }
    setChange({ type: "changing", target: `${provider}/${modelId}` });
    try {
      await binding.onModel(provider, modelId);
      setChange({ type: "idle" });
      onClose(true);
    } catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  async function pickLevel(level: string) {
    if (busy || level === binding.thinkingLevel) return;
    setChange({ type: "changing", target: `level:${level}` });
    try { await binding.onThinkingLevel(level); setChange({ type: "idle" }); }
    catch (error) { setChange({ type: "failed", message: messageOf(error) }); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".model-row:not(:disabled)") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  }

  const levelChoices = levels.type === "ready" ? levels.value : [];
  return <div ref={panel} id={id} className="model-panel" role="dialog" aria-label="Model and thinking level" onKeyDown={onKeyDown}>
    <input ref={search} type="search" className="model-search" placeholder="Search models" aria-label="Search models"
      value={query} onChange={(event) => setQuery(event.target.value)} enterKeyHint="search" />
    <div className="model-list">
      {models.type === "loading" && <p className="model-hint" role="status">Loading models…</p>}
      {models.type === "failed" && <p className="model-hint" role="alert">Models unavailable: {models.message}</p>}
      {models.type === "ready" && groups.length === 0 && <p className="model-hint" role="status">
        {query.trim() ? `No model matches "${query.trim()}".` : "Pi offers no models for this session."}
      </p>}
      {groups.map((group) => <section key={group.key} className="model-group" aria-label={group.label}>
        <h3 className="model-group-label">{group.label}</h3>
        <ul>{group.rows.map((row) => {
          const active = row.key === activeKey;
          const changing = change.type === "changing" && change.target === row.key;
          return <li key={row.key}>
            <button type="button" className="model-row" aria-pressed={active} data-plain={row.plain || undefined}
              disabled={busy && !active} aria-busy={changing || undefined} onClick={() => void pickModel(row.provider, row.id)}>
              <span className="model-row-name">{row.label}{row.variant && <span className="model-row-variant">{row.variant}</span>}</span>
              <span className="model-row-meta">
                {row.providerName && <span>{row.providerName}</span>}
                {row.context && <span>{row.context} context</span>}
                {row.plain && <span>no thinking</span>}
                {changing && <span>Switching…</span>}
              </span>
              {active && <CheckIcon aria-hidden size={16} className="model-row-check" />}
            </button>
          </li>;
        })}</ul>
      </section>)}
    </div>
    <div className="model-thinking" role="group" aria-labelledby={`${id}-thinking`}>
      <span id={`${id}-thinking`} className="model-thinking-label">Thinking</span>
      {levels.type === "loading" && <span className="model-hint" role="status">Loading…</span>}
      {levels.type === "failed" && <span className="model-hint" role="alert">Levels unavailable: {levels.message}</span>}
      {levels.type === "ready" && levelChoices.length <= 1 && <span className="model-hint">This model does not think.</span>}
      {levelChoices.length > 1 && <div className="model-levels">
        {levelChoices.map((item) => <button key={item} type="button" aria-pressed={item === binding.thinkingLevel}
          disabled={busy && item !== binding.thinkingLevel} onClick={() => void pickLevel(item)}>{thinkingLabel(item)}</button>)}
      </div>}
    </div>
    {change.type === "failed" && <p className="model-error" role="alert">{change.message}</p>}
  </div>;
}
