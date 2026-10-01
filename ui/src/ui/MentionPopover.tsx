import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ComponentProps, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, useAuiState, unstable_useTriggerPopoverScopeContext, type Unstable_TriggerItem } from "@assistant-ui/react";
import { CpuIcon, FileTextIcon, FolderIcon, XIcon } from "lucide-react";
import type { MentionSource } from "../mentionSource";
import { mentionFormatter, mentionMatcher, mentionPlacement, type MentionTrigger } from "../mentionSyntax";

export type MentionInputSnapshot = { text: string; cursor: number } | null;
type Adapter = NonNullable<ComponentProps<typeof ComposerPrimitive.Unstable_TriggerPopover>["adapter"]>;
type Results = { type: "loading" } | { type: "ready"; items: readonly Unstable_TriggerItem[] } | { type: "error"; message: string };
const empty: readonly Unstable_TriggerItem[] = [];

/** Async edge for a synchronous SDK adapter. Query changes immediately hide old results. */
function useSuggestions(source: MentionSource, char: MentionTrigger, enabled: boolean) {
  const [query, setQuery] = useState<string>();
  const [saved, setSaved] = useState<{ query: string; result: Results }>();
  const result: Results = query !== undefined && saved?.query === query ? saved.result : { type: "loading" };
  const items = result.type === "ready" ? result.items : empty;
  const adapter = useMemo<Adapter>(() => ({ categories: () => [], categoryItems: () => [],
    search: (search) => enabled && search === query ? items : empty }), [enabled, query, items]);
  useEffect(() => {
    if (query === undefined || !enabled) return;
    const controller = new AbortController();
    setSaved({ query, result: { type: "loading" } });
    const timer = setTimeout(() => {
      const request = char === "#" ? source.models(query, controller.signal)
        : source.files(char === "@" && query.startsWith(" ") ? query.slice(1) : query,
          char !== "@" || query.startsWith(" ") ? "all" : "tracked", controller.signal);
      request.then((next) => {
        if (!controller.signal.aborted) setSaved({ query, result: { type: "ready", items: next } });
      }, (error: unknown) => {
        if (!controller.signal.aborted) setSaved({ query, result: { type: "error", message: error instanceof Error ? error.message : String(error) } });
      });
    }, 60);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, char, query, enabled]);
  return { adapter, result, setQuery, query };
}

/** System molecule: assistant-ui owns trigger detection, insertion, keyboard selection and ARIA. */
export function MentionPopover({ source, char, enabled, input, snapshot }: {
  source: MentionSource; char: MentionTrigger; enabled: boolean; input: RefObject<HTMLTextAreaElement | null>;
  snapshot: RefObject<MentionInputSnapshot>;
}) {
  const { adapter, result, setQuery, query } = useSuggestions(source, char, enabled);
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
  const [caret, setCaret] = useState<{ text: string; position: number }>();
  const text = useAuiState((state) => state.composer.text);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element || !caret || text !== caret.text) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(caret.position, caret.position);
  }, [caret, input, text]);
  const label = char === "#" ? "Models" : char === "@" && !query?.startsWith(" ") ? "Files" : "All files";
  return createPortal(<ComposerPrimitive.Unstable_TriggerPopover ref={positionPopup} char={char} adapter={adapter}
    matcher={enabled ? mentionMatcher : inactiveMatcher} isLoading={result.type === "loading"}
    className="mention-popover" aria-label={`${label} suggestions`}>
    <MentionInsertion char={char} snapshot={snapshot} onCaret={setCaret} />
    <MentionResults label={label} result={result} input={input} snapshot={snapshot} onQuery={setQuery} />
  </ComposerPrimitive.Unstable_TriggerPopover>, document.body);
}
const inactiveMatcher = () => null;

function MentionInsertion({ char, snapshot, onCaret }: {
  char: MentionTrigger; snapshot: RefObject<MentionInputSnapshot>; onCaret: (caret: { text: string; position: number }) => void;
}) {
  const scope = unstable_useTriggerPopoverScopeContext();
  const prefix = char === "@" && scope.query.startsWith(" ") ? "@ " : char;
  const formatter = useMemo(() => mentionFormatter(prefix), [prefix]);
  return <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={formatter} onInserted={(item) => {
    const previous = snapshot.current;
    if (!previous) return;
    const match = mentionMatcher(previous.text, char, previous.cursor);
    if (!match) return;
    const reference = formatter.serialize(item);
    const directory = item.type === "file" && item.id.endsWith("/");
    const position = match.offset + reference.length + (directory ? reference.endsWith('"') ? -1 : 0 : 1);
    // SDK updates its logical cursor, but native textarea selection also needs
    // restoring after React commits the inserted text, especially mid-sentence.
    scope.setCursorPosition(position);
    const after = previous.text.slice(match.endOffset);
    onCaret({ text: previous.text.slice(0, match.offset) + reference + (after.startsWith(" ") ? after : ` ${after}`), position });
  }} />;
}

function MentionResults({ label, result, input, snapshot, onQuery }: {
  label: string; result: Results; input: RefObject<HTMLTextAreaElement | null>; snapshot: RefObject<MentionInputSnapshot>;
  onQuery: (query: string | undefined) => void;
}) {
  const scope = unstable_useTriggerPopoverScopeContext();
  useLayoutEffect(() => { onQuery(scope.open ? scope.query : undefined); }, [scope.open, scope.query, onQuery]);
  useEffect(() => {
    if (scope.open && scope.highlightedItemId) document.getElementById(scope.highlightedItemId)?.scrollIntoView({ block: "nearest" });
  }, [scope.open, scope.highlightedItemId]);
  if (!scope.open) return null;
  return <>
    <div className="mention-header">
      <span>{label}</span>
      <button type="button" className="mention-close" tabIndex={-1} aria-label={`Dismiss ${label.toLowerCase()} suggestions`}
        onMouseDown={(event) => event.preventDefault()} onClick={scope.close}><XIcon size={14} aria-hidden /></button>
    </div>
    {result.type === "loading" && <p className="mention-status" role="status">Searching…</p>}
    {result.type === "error" && <p className="mention-status" role="alert">{result.message}</p>}
    {result.type === "ready" && result.items.length === 0 && <p className="mention-status" role="status">No matching {label.toLowerCase()}.</p>}
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(items) => items.map((item) => {
        const Icon = item.type === "model" ? CpuIcon : item.id.endsWith("/") ? FolderIcon : FileTextIcon;
        return <ComposerPrimitive.Unstable_TriggerPopoverItem key={item.id} item={item} tabIndex={-1}
          className="mention-option" onMouseDown={(event) => event.preventDefault()}
          onClick={() => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; }}>
          <Icon size={16} aria-hidden />
          <span className="mention-description"><span>{item.label}</span>{item.description && <small>{item.description}</small>}</span>
        </ComposerPrimitive.Unstable_TriggerPopoverItem>;
      })}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  </>;
}
