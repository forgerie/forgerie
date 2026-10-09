import { usePortalTarget } from "./portalLayer";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, useAuiState, unstable_useTriggerPopoverScopeContext, type Unstable_TriggerItem } from "@assistant-ui/react";
import { EyeIcon, EyeOffIcon, FileTextIcon, FolderIcon, XIcon } from "lucide-react";
import type { MentionSource, ModelSuggestions, ModelThinking } from "../mentionSource";
import { mentionFormatter, mentionMatcher, mentionPlacement, type MentionTrigger } from "../mentionSyntax";
import type { ComposerInputElement } from "./ComposerEditor";
import { FloatingPanel } from "./FloatingPanel";
import { OptionList, type OptionGroup, type OptionItem } from "./OptionList";
import { ToggleGroup } from "./ToggleGroup";

export type MentionInputSnapshot = { text: string; cursor: number } | null;
type Adapter = NonNullable<ComponentProps<typeof ComposerPrimitive.Unstable_TriggerPopover>["adapter"]>;
/** Suggestions as the list draws them, and as the composer inserts them. */
interface Found {
  groups: readonly OptionGroup[];
  items: ReadonlyMap<string, Unstable_TriggerItem>;
  toggle?: { show: string; hide: string } | undefined;
  thinking: Readonly<Record<string, ModelThinking>>;
}
/** The model the highlight was on for a query, so `query:` lists that model's levels. */
type Highlight = { query: string; key: string } | undefined;
type Results = { type: "loading" } | { type: "ready"; found: Found } | { type: "error"; message: string };
const empty: readonly Unstable_TriggerItem[] = [];

function fileResults(items: readonly Unstable_TriggerItem[]): Found {
  const options: OptionItem[] = items.map((item) => ({ id: item.id, name: item.label, details: item.description ? [item.description] : [],
    icon: item.id.endsWith("/") ? <FolderIcon size={16} /> : <FileTextIcon size={16} /> }));
  return { groups: [{ key: "files", options }], items: new Map(items.map((item) => [item.id, item])), thinking: {} };
}
function modelResults({ groups, toggle, thinking }: ModelSuggestions): Found {
  // The composer inserts `#provider/id`, so the item's identity is the model key the row carries.
  const items = groups.flatMap((group) => group.options.map((option): Unstable_TriggerItem => ({ id: option.id, type: "model", label: option.id })));
  return { groups, items: new Map(items.map((item) => [item.id, item])), toggle, thinking };
}

/** Async edge for a synchronous SDK adapter. Query changes immediately hide old results. */
function useSuggestions(source: MentionSource, char: MentionTrigger, enabled: boolean, showHidden: boolean, highlight: RefObject<Highlight>) {
  const [query, setQuery] = useState<string>();
  const [saved, setSaved] = useState<{ query: string; showHidden: boolean; result: Results }>();
  const result: Results = query !== undefined && saved?.query === query && saved.showHidden === showHidden ? saved.result : { type: "loading" };
  const items = useMemo(() => result.type === "ready" ? [...result.found.items.values()] : empty, [result]);
  const adapter = useMemo<Adapter>(() => ({ categories: () => [], categoryItems: () => [],
    search: (search) => enabled && search === query ? items : empty }), [enabled, query, items]);
  useEffect(() => {
    if (query === undefined || !enabled) return;
    const controller = new AbortController();
    setSaved({ query, showHidden, result: { type: "loading" } });
    const timer = setTimeout(() => {
      const base = query.slice(0, Math.max(0, query.lastIndexOf(":")));
      const prefer = query.includes(":") && highlight.current?.query === base ? highlight.current.key : undefined;
      const request: Promise<Found> = char === "#" ? source.models(query, { showHidden, prefer }, controller.signal).then(modelResults)
        : source.files(char === "@" && query.startsWith(" ") ? query.slice(1) : query,
          char !== "@" || query.startsWith(" ") ? "all" : "tracked", controller.signal).then(fileResults);
      request.then((found) => {
        if (!controller.signal.aborted) setSaved({ query, showHidden, result: { type: "ready", found } });
      }, (error: unknown) => {
        if (!controller.signal.aborted) setSaved({ query, showHidden, result: { type: "error", message: error instanceof Error ? error.message : String(error) } });
      });
    }, 60);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, char, query, enabled, showHidden, highlight]);
  return { adapter, result, setQuery, query };
}

/**
 * System molecule: assistant-ui owns trigger detection, insertion, keyboard
 * selection and ARIA. The suggestions are an option list in highlight mode,
 * so `#` shows models the way the model menu does. A model takes a thinking
 * level two ways: type `:` after it to list its levels, or press one in the
 * Thinking row, which applies to the model the reference inserts.
 */
export function MentionPopover({ source, char, enabled, input, snapshot }: {
  source: MentionSource; char: MentionTrigger; enabled: boolean; input: RefObject<ComposerInputElement | null>;
  snapshot: RefObject<MentionInputSnapshot>;
}) {
  const layer = usePortalTarget();
  const [showHidden, setShowHidden] = useState(false);
  const highlight = useRef<Highlight>(undefined);
  const { adapter, result, setQuery, query } = useSuggestions(source, char, enabled, showHidden, highlight);
  // A pressed level, kept until the list closes. "" keeps the session's level, even over a favorite's own.
  const [chosen, setChosen] = useState<string>();
  useEffect(() => { if (query === undefined) setChosen(undefined); }, [query]);
  const thinking = result.type === "ready" ? result.found.thinking : undefined;
  const levelOf = useRef<(id: string) => string>(() => "");
  levelOf.current = (id) => {
    const model = thinking?.[id];
    const level = chosen ?? model?.preset;
    return model && level && model.levels.some((item) => item.value === level) ? `:${level}` : "";
  };
  const [caret, setCaret] = useState<{ text: string; position: number }>();
  const text = useAuiState((state) => state.composer.text);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element || !caret || text !== caret.text) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(caret.position, caret.position);
  }, [caret, input, text]);
  const label = char === "#" ? "Models" : char === "@" && !query?.startsWith(" ") ? "Files" : "All files";
  return createPortal(<ComposerPrimitive.Unstable_TriggerPopover char={char} adapter={adapter}
    matcher={enabled ? mentionMatcher : inactiveMatcher} isLoading={result.type === "loading"} aria-label={`${label} suggestions`}>
    <MentionInsertion char={char} snapshot={snapshot} onCaret={setCaret} levelOf={levelOf} />
    <MentionResults label={label} result={result} input={input} snapshot={snapshot} onQuery={setQuery}
      showHidden={showHidden} onShowHidden={setShowHidden} highlight={highlight} chosen={chosen} onChoose={setChosen} />
  </ComposerPrimitive.Unstable_TriggerPopover>, layer);
}
const inactiveMatcher = () => null;

function MentionInsertion({ char, snapshot, onCaret, levelOf }: {
  char: MentionTrigger; snapshot: RefObject<MentionInputSnapshot>; onCaret: (caret: { text: string; position: number }) => void;
  levelOf: RefObject<(id: string) => string>;
}) {
  const scope = unstable_useTriggerPopoverScopeContext();
  const prefix = char === "@" && scope.query.startsWith(" ") ? "@ " : char;
  const formatter = useMemo(() => mentionFormatter(prefix, (id) => levelOf.current(id)), [prefix, levelOf]);
  return <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={formatter} onInserted={(item) => {
    const previous = snapshot.current;
    if (!previous) return;
    const match = mentionMatcher(previous.text, char, previous.cursor);
    if (!match) return;
    const reference = formatter.serialize(item);
    const directory = item.type === "file" && item.id.endsWith("/");
    const position = match.offset + reference.length + (directory ? reference.endsWith('"') ? -1 : 0 : 1);
    // SDK updates its logical cursor, but the editor's selection also needs
    // restoring after React commits the inserted text, especially mid-sentence.
    scope.setCursorPosition(position);
    const after = previous.text.slice(match.endOffset);
    onCaret({ text: previous.text.slice(0, match.offset) + reference + (after.startsWith(" ") ? after : ` ${after}`), position });
  }} />;
}

function MentionResults({ label, result, input, snapshot, onQuery, showHidden, onShowHidden, highlight, chosen, onChoose }: {
  label: string; result: Results; input: RefObject<ComposerInputElement | null>; snapshot: RefObject<MentionInputSnapshot>;
  onQuery: (query: string | undefined) => void; showHidden: boolean; onShowHidden: (showHidden: boolean) => void;
  highlight: RefObject<Highlight>; chosen: string | undefined; onChoose: (level: string) => void;
}) {
  const scope = unstable_useTriggerPopoverScopeContext();
  const highlighted = scope.open ? scope.items[scope.highlightedIndex]?.id : undefined;
  useEffect(() => {
    if (highlighted !== undefined && !scope.query.includes(":")) highlight.current = { query: scope.query, key: highlighted };
  }, [highlight, highlighted, scope.query]);
  useLayoutEffect(() => { onQuery(scope.open ? scope.query : undefined); }, [scope.open, scope.query, onQuery]);
  useEffect(() => {
    if (scope.open && scope.highlightedItemId) document.getElementById(scope.highlightedItemId)?.scrollIntoView({ block: "nearest" });
  }, [scope.open, scope.highlightedItemId]);
  const positionPopup = useCallback((panel: HTMLDivElement | null) => {
    const anchor = input.current;
    if (!anchor || !panel) return;
    const viewport = window.visualViewport;
    const position = () => {
      const plan = mentionPlacement(anchor.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      });
      // These inline values are measured window geometry, not theme decisions.
      Object.assign(panel.style, { left: `${plan.left}px`, top: `${plan.top}px`, width: `${plan.width}px`,
        maxHeight: `${plan.maxHeight}px`, transform: plan.up ? "translateY(-100%)" : "none" });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
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
  }, [input]);
  if (!scope.open) return null;
  const found = result.type === "ready" ? result.found : undefined;
  const status = result.type === "loading" ? { tone: "status" as const, text: "Searching…" }
    : result.type === "error" ? { tone: "alert" as const, text: result.message }
    : found!.groups.every((group) => group.options.length === 0) ? { tone: "status" as const, text: `No matching ${label.toLowerCase()}.` } : undefined;
  // The menu counts matching hidden models while they show too, so the command to hide them stays.
  const toggle = found?.toggle;
  const model = highlighted === undefined ? undefined : found?.thinking[highlighted];
  const level = chosen ?? model?.preset ?? "";
  const levels = model?.levels ?? [];
  return <FloatingPanel ref={positionPopup}>
    <div className="mention-header">
      <span>{label}</span>
      <button type="button" className="mention-close" tabIndex={-1} aria-label={`Dismiss ${label.toLowerCase()} suggestions`}
        onMouseDown={(event) => event.preventDefault()} onClick={scope.close}><XIcon size={14} aria-hidden /></button>
    </div>
    <OptionList label={`${label} suggestions`} groups={found?.groups ?? []} status={status}
      action={toggle ? { label: showHidden ? toggle.hide : toggle.show, pressed: showHidden,
        icon: showHidden ? <EyeOffIcon aria-hidden size={14} /> : <EyeIcon aria-hidden size={14} />, onPress: () => onShowHidden(!showHidden) } : undefined}
      input={{ type: "highlight", wrap: (row, option) => {
        const item = found?.items.get(option.id);
        return item ? <ComposerPrimitive.Unstable_TriggerPopoverItem asChild item={item}
          onClick={() => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; }}>
          {row}</ComposerPrimitive.Unstable_TriggerPopoverItem> : row;
      } }} />
    {model && levels.length > 1 && <div className="mention-thinking" onMouseDownCapture={(event) => event.preventDefault()}>
      <span className="mention-thinking-label">Thinking</span>
      <span className="mention-thinking-levels"><ToggleGroup label="Thinking level" value={levels.some((item) => item.value === level) ? level : ""} onChange={onChoose}
        options={[{ value: "", label: "Inherit", title: "Keep this session's thinking level" }, ...levels]} /></span>
    </div>}
  </FloatingPanel>;
}
