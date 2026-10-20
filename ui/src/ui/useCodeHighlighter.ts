import { useEffect, useState, type RefObject } from "react";

type Highlighter = typeof import("./highlightCode").highlightCode;
let loaded: Highlighter | undefined;
let loading: Promise<Highlighter> | undefined;

// One optional module, shared by code sheets, not a cache of transcript text.
// Keep the full registry together: embedded languages must see the same
// grammars regardless of which fence happened to load first.
function load(): Promise<Highlighter> {
  loading ??= import("./highlightCode").then(({ highlightCode }) => (loaded = highlightCode)).catch((error: unknown) => {
    loading = undefined;
    console.error("Code highlighting could not load; source remains readable.", error);
    throw error;
  });
  return loading;
}

function selectionTouches(selection: Selection, element: Node): boolean {
  for (let index = 0; index < selection.rangeCount; index++) if (selection.getRangeAt(index).intersectsNode(element)) return true;
  return false;
}

/** Plain source remains in the DOM while the optional colour enhancement loads. */
export function useCodeHighlighter(enabled: boolean, source: RefObject<HTMLElement | null>): Highlighter | undefined {
  const [value, setValue] = useState(() => loaded);
  useEffect(() => {
    if (!enabled || value) return;
    let current = true;
    let releaseSelection: (() => void) | undefined;
    void load().then((highlight) => {
      if (!current) return;
      const element = source.current;
      const document = element?.ownerDocument;
      const publish = () => {
        const selection = document?.getSelection();
        // Colour replaces text nodes. Never collapse a selection the reader
        // made while the module was arriving; wait until it leaves this sheet.
        // `containsNode(element, true)` is false when the whole selection lies inside the sheet, so test each range.
        if (element && selection && !selection.isCollapsed && selectionTouches(selection, element)) return;
        releaseSelection?.();
        setValue(() => highlight);
      };
      releaseSelection = () => document?.removeEventListener("selectionchange", publish);
      document?.addEventListener("selectionchange", publish);
      publish();
    }, () => {
      // The loader reports the failure once; every sheet keeps its source.
    });
    return () => { current = false; releaseSelection?.(); };
  }, [enabled, value, source]);
  return enabled ? value : undefined;
}
