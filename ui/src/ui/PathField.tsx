import { cloneElement, useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { FileTextIcon, FolderIcon } from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { TextField } from "./TextField";
import { SuggestionHeader } from "./SuggestionHeader";
import { OptionList, type OptionStatus } from "./OptionList";
import type { OptionRowProps } from "./OptionRow";
import { usePanelPlacement } from "./usePanelPlacement";
import { usePortalTarget } from "./portalLayer";
import "./PathField.css";

/** Completion values are plain paths, without mention markers or quoting. Folders end in `/`. */
export type PathSuggest = (query: string, signal: AbortSignal) => Promise<readonly string[]>;
export interface PathSuggestions { label: string; source: PathSuggest }
type Results = { type: "loading" } | { type: "ready"; paths: readonly string[] } | { type: "error"; message: string };
const empty: readonly string[] = [];

function usePaths(source: PathSuggest, query: string, open: boolean) {
  const [saved, setSaved] = useState<{ source: PathSuggest; query: string; result: Results }>();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void source(query, controller.signal).then((paths) => {
        if (!controller.signal.aborted) setSaved({ source, query, result: { type: "ready", paths } });
      }, (cause: unknown) => {
        if (!controller.signal.aborted) setSaved({ source, query, result: { type: "error", message: cause instanceof Error ? cause.message : String(cause) } });
      });
    }, 60);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, query, open]);
  return saved?.source === source && saved.query === query ? saved.result : { type: "loading" } as const;
}

/**
 * System molecule: a path-only combobox using the composer's suggestion surface.
 * Focus, typing or ArrowDown opens it. Arrows move the highlight; Enter/Tab or a press
 * completes it. Completing a folder lists its children with no initial highlight,
 * so Enter can submit that folder rather than choose an unwanted child. Tab or
 * ArrowDown continues browsing. Escape and blur close it without changing the path.
 * The caller supplies discovery, so files and folders use the same interaction.
 */
export function PathField({ value, onChange, suggestions, disabled, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onKeyDown" | "onBlur" | "onFocus" | "role" | "className" | "style"> & {
  value: string; onChange: (value: string) => void; suggestions: PathSuggestions;
}) {
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const layer = usePortalTarget();
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const open = opened && !disabled;
  const result = usePaths(suggestions.source, value, open);
  const paths = result.type === "ready" ? result.paths : empty;
  const active = open && highlight >= 0 && highlight < paths.length ? `${id}-${String(highlight)}` : undefined;
  // Match the composer's popup cap; placement also accounts for the touch keyboard.
  usePanelPlacement(panel, input, 288, 0, open);
  useEffect(() => { if (active) document.getElementById(active)?.scrollIntoView?.({ block: "nearest" }); }, [active]);
  const choose = (path: string) => {
    onChange(path); setHighlight(-1); setOpened(path.endsWith("/"));
  };
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpened(false); return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpened(true); setHighlight(event.key === "ArrowDown" ? 0 : paths.length - 1); }
      else if (paths.length) setHighlight((previous) => event.key === "ArrowDown" ? (previous + 1) % paths.length
        : previous <= 0 ? paths.length - 1 : previous - 1);
      return;
    }
    if (open && !event.shiftKey && (event.key === "Enter" || event.key === "Tab")) {
      const path = paths[highlight] ?? (event.key === "Tab" ? paths[0] : undefined);
      if (path) { event.preventDefault(); choose(path); }
      else setOpened(false); // No match must not prevent submission of a new folder.
    }
  }
  const status: OptionStatus | undefined = result.type === "loading" ? { tone: "status", text: "Searching…" }
    : result.type === "error" ? { tone: "alert", text: result.message }
    : paths.length === 0 ? { tone: "status", text: `No matching ${suggestions.label.toLowerCase()}.` } : undefined;
  return <>
    <TextField {...props} ref={input} disabled={disabled} value={value} role="combobox" aria-autocomplete="list"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={active}
      autoComplete="off" autoCapitalize="off" spellCheck={false}
      onChange={(event) => { onChange(event.target.value); setHighlight(0); setOpened(true); }}
      onFocus={() => { setOpened(true); setHighlight(0); }} onBlur={() => setOpened(false)} onKeyDown={keyDown} />
    {open && createPortal(<FloatingPanel ref={panel}>
      <SuggestionHeader label={suggestions.label} onDismiss={() => setOpened(false)} />
      <div className="path-field-options" id={id} role="listbox" aria-label={`${suggestions.label} suggestions`}>
        <OptionList label={`${suggestions.label} suggestions`} status={status}
          groups={[{ key: "paths", options: paths.map((path) => ({ id: path, name: path,
            icon: path.endsWith("/") ? <FolderIcon size={16} /> : <FileTextIcon size={16} /> })) }]}
          input={{ type: "highlight", wrap: (row, option) => {
            const index = paths.indexOf(option.id);
            return cloneElement(row as ReactElement<OptionRowProps & { "data-highlighted"?: string | undefined }>, { id: `${id}-${String(index)}`, role: "option", "aria-selected": index === highlight,
              "data-highlighted": index === highlight ? "" : undefined,
              onMouseMove: () => setHighlight(index), onClick: () => choose(option.id) });
          } }} />
      </div>
    </FloatingPanel>, layer)}
  </>;
}
