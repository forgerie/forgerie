import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, unstable_useSlashCommandAdapter, useAuiState } from "@assistant-ui/react";
import { matchSlash, paletteDescription, piCommandFormatter, type CommandCatalog } from "../commands";
import { FloatingPanel } from "./FloatingPanel";
import { OptionList } from "./OptionList";
import { usePortalTarget } from "./portalLayer";

export interface CommandBinding {
  catalog: CommandCatalog;
  onRetry: () => void;
}

/** The room the palette may take above the composer, and the gap it keeps from it. */
const PANEL_MAX_BLOCK = "22rem";
const PANEL_GAP = 8;

/** Measured window geometry, not a theme decision: the panel rides the composer's top edge. */
function placePanel(element: HTMLDivElement | null, anchor: HTMLDivElement | null) {
  if (!element || !anchor) return;
  const box = anchor.getBoundingClientRect();
  const room = Math.max(0, box.top - (window.visualViewport?.offsetTop ?? 0) - PANEL_GAP);
  element.style.left = `${box.left}px`;
  element.style.width = `${box.width}px`;
  element.style.top = "auto";
  element.style.bottom = `${window.innerHeight - box.top + PANEL_GAP}px`;
  element.style.maxHeight = `min(${PANEL_MAX_BLOCK}, ${room}px)`;
}

/**
 * System molecule: Pi's `/` completion. assistant-ui owns trigger detection,
 * insertion, keyboard selection and ARIA; the choices are an option list in
 * highlight mode, so the palette reads the way every other list does.
 *
 * One row is one height. A command carries a line for a person, shown after
 * its name; a skill carries a paragraph for the model, so it shows its name
 * alone (`paletteDescription` holds that rule).
 */
export function SlashCommands({ binding, anchor }: { binding: CommandBinding; anchor: RefObject<HTMLDivElement | null> }) {
  const layer = usePortalTarget();
  const disabled = useAuiState((state) => state.thread.isDisabled);
  const panel = useRef<HTMLDivElement>(null);
  const highlightObserver = useRef<MutationObserver | null>(null);
  const { catalog } = binding;
  const slash = unstable_useSlashCommandAdapter({ commands: useMemo(() => (catalog.type === "ready" ? catalog.commands : []).map((command) => {
    const description = paletteDescription(command);
    return {
      id: command.name, label: `/${command.name}`,
      ...(description === undefined ? {} : { description }),
      // Pi selection is completion, not execution. Keep arguments editable and
      // require Send, especially for commands that mutate the session.
      // The anchor may be the whole box or only part of it, so look from the composer root.
      execute: () => (anchor.current?.closest(".composer") ?? anchor.current)?.querySelector<HTMLElement>("[data-composer-input]")?.focus(),
    };
  }), [catalog, anchor]) });
  const setPanel = useCallback((element: HTMLDivElement | null) => {
    highlightObserver.current?.disconnect();
    panel.current = element;
    placePanel(element, anchor.current);
    if (!element) return;
    // The stock picker owns keyboard selection, but not scroll visibility.
    // Bring the highlighted row into view, and scroll nothing else.
    highlightObserver.current = new MutationObserver(() => {
      element.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({ block: "nearest" });
    });
    highlightObserver.current.observe(element, { subtree: true, attributes: true, attributeFilter: ["data-highlighted"] });
  }, [anchor]);

  useLayoutEffect(() => {
    const position = () => placePanel(panel.current, anchor.current);
    position();
    const observer = new ResizeObserver(position);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [anchor, catalog, disabled]);

  return createPortal(<ComposerPrimitive.Unstable_TriggerPopover char="/" adapter={slash.adapter}
    matcher={disabled ? () => null : matchSlash} isLoading={catalog.type === "loading"} aria-label="Pi commands">
    <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} formatter={piCommandFormatter} />
    {/* The primitive renders its children only through a behaviour, so the panel lives in `Items`. */}
    <ComposerPrimitive.Unstable_TriggerPopoverItems>{(items) => <FloatingPanel ref={setPanel}>
      {catalog.type === "loading" && <p className="command-hint" role="status">Loading commands…</p>}
      {catalog.type === "failed" && <div className="command-hint" role="alert">
        <p>Commands unavailable: {catalog.message}</p><button type="button" onClick={binding.onRetry}>Retry</button>
      </div>}
      {catalog.type === "ready" && items.length === 0 && <p className="command-hint" role="status">No matching commands. Pi checks commands when you send.</p>}
      {items.length > 0 && <OptionList label="Pi commands" groups={[{ key: "commands", options: items.map((item) => ({
        id: item.id, name: item.label, detailsPlacement: "trailing" as const,
        ...(item.description === undefined ? {} : { details: [item.description] }),
      })) }]} input={{ type: "highlight", wrap: (row, option) => {
        const item = items.find((candidate) => candidate.id === option.id);
        return item === undefined ? row : <ComposerPrimitive.Unstable_TriggerPopoverItem asChild item={item}>{row}</ComposerPrimitive.Unstable_TriggerPopoverItem>;
      } }} />}
    </FloatingPanel>}</ComposerPrimitive.Unstable_TriggerPopoverItems>
  </ComposerPrimitive.Unstable_TriggerPopover>, layer);
}
