import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ComposerPrimitive, unstable_useSlashCommandAdapter, useAuiState } from "@assistant-ui/react";
import { matchSlash, piCommandFormatter, type CommandCatalog } from "../commands";

function positionPopover(element: HTMLDivElement | null, anchor: HTMLDivElement | null) {
  if (!element || !anchor) return;
  const box = anchor.getBoundingClientRect();
  const top = window.visualViewport?.offsetTop ?? 0;
  element.style.left = `${box.left}px`;
  element.style.width = `${box.width}px`;
  element.style.bottom = `${window.innerHeight - box.top}px`;
  element.style.setProperty("--command-room", `${Math.max(0, box.top - top)}px`);
}

export interface CommandBinding {
  catalog: CommandCatalog;
  onRetry: () => void;
}

/** System molecule: the stock assistant-ui picker, with plain Pi text and a window-level popup. */
export function SlashCommands({ binding, anchor }: { binding: CommandBinding; anchor: RefObject<HTMLDivElement | null> }) {
  const text = useAuiState((s) => s.composer.text);
  const disabled = useAuiState((s) => s.thread.isDisabled);
  const popover = useRef<HTMLDivElement>(null);
  const highlightObserver = useRef<MutationObserver | null>(null);
  const setPopover = useCallback((element: HTMLDivElement | null) => {
    highlightObserver.current?.disconnect();
    popover.current = element;
    positionPopover(element, anchor.current);
    if (!element) return;
    // The stock picker owns keyboard selection, but not scroll visibility.
    // Scroll only this collection, never the surrounding transcript.
    highlightObserver.current = new MutationObserver(() => {
      const option = element.querySelector<HTMLElement>("[data-highlighted]");
      if (!option) return;
      const item = option.getBoundingClientRect();
      const list = element.getBoundingClientRect();
      if (item.top < list.top) element.scrollTop -= list.top - item.top;
      else if (item.bottom > list.bottom) element.scrollTop += item.bottom - list.bottom;
    });
    highlightObserver.current.observe(element, { subtree: true, attributes: true, attributeFilter: ["data-highlighted"] });
  }, [anchor]);
  const { catalog } = binding;
  const slash = unstable_useSlashCommandAdapter({ commands: catalog.type === "ready" ? catalog.commands.map((command) => ({
    id: command.name, description: command.description,
    // Pi selection is completion, not execution. Keep arguments editable and
    // require Send, especially for commands that mutate the session.
    execute: () => anchor.current?.querySelector("textarea")?.focus(),
  })) : [] });

  useLayoutEffect(() => {
    const position = () => positionPopover(popover.current, anchor.current);
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
  }, [anchor, text, catalog, disabled]);

  return createPortal(<ComposerPrimitive.Unstable_TriggerPopover char="/" adapter={slash.adapter}
    matcher={disabled ? () => null : matchSlash} isLoading={catalog.type === "loading"}
    ref={setPopover}
    className="command-popover" aria-label="Pi commands">
    <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} formatter={piCommandFormatter} />
    {catalog.type === "loading" && <p className="command-hint" role="status">Loading commands…</p>}
    {catalog.type === "failed" && <div className="command-hint" role="alert">
      <p>Commands unavailable: {catalog.message}</p><button type="button" onClick={binding.onRetry}>Retry</button>
    </div>}
    <ComposerPrimitive.Unstable_TriggerPopoverItems>{(items) => <>
      {catalog.type === "ready" && items.length === 0 && <p className="command-hint" role="status">No matching commands. Pi checks commands when you send.</p>}
      {items.map((item, index) => <ComposerPrimitive.Unstable_TriggerPopoverItem key={item.id} item={item} index={index} className="command-option">
        <span>{item.label}</span>{item.description && <small>{item.description}</small>}
      </ComposerPrimitive.Unstable_TriggerPopoverItem>)}
    </>}</ComposerPrimitive.Unstable_TriggerPopoverItems>
  </ComposerPrimitive.Unstable_TriggerPopover>, document.body);
}
