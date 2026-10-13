import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "lucide-react";
import { useMenu } from "./useMenu";
import { usePortalTarget } from "./portalLayer";
import "./MenuButton.css";

export interface MenuCommand {
  label: string;
  icon?: ReactNode;
  tone?: "danger" | undefined;
  disabled?: boolean | undefined;
  /** Words for a second press. The first press shows them and runs nothing. */
  confirm?: string | undefined;
  onSelect: () => void;
}

/**
 * Molecule: rare commands one tap away, behind a "more" button. The menu
 * opens under the button with full-size rows. Arrow keys move between rows;
 * Escape or a press outside closes it. A command with `confirm` asks again in
 * place before it runs.
 */
export function MenuButton({ label, commands, align = "end", layer = "inline" }: {
  label: string; commands: readonly (MenuCommand | "separator")[];
  /** Which edge of the button the menu lines up with. A button near the end of a row opens toward the start. */
  align?: "start" | "end";
  /**
   * `window` opens the menu at window level, so a scrolling list or a narrow pane never clips it: under the
   * button, or above it when the room below is short. Use it for a button inside a list.
   */
  layer?: "inline" | "window";
}) {
  const list = useRef<HTMLDivElement>(null);
  const menu = useMenu(layer === "window" ? list : undefined);
  const [asking, setAsking] = useState<string>();
  const { open, setOpen } = menu;
  const target = usePortalTarget();
  // At window level, the menu is placed against the button each time it opens and closes when the page scrolls under it.
  useLayoutEffect(() => {
    if (!open || layer !== "window") return;
    const element = list.current;
    const button = menu.anchor.current;
    if (!element || !button) return;
    const place = () => {
      const box = button.getBoundingClientRect();
      const room = window.visualViewport?.height ?? window.innerHeight;
      const width = window.visualViewport?.width ?? window.innerWidth;
      const up = box.bottom + element.offsetHeight + 8 > room && box.top > room - box.bottom;
      // Measured window geometry, not theme decisions.
      Object.assign(element.style, {
        top: up ? "auto" : `${String(box.bottom + 4)}px`, bottom: up ? `${String(room - box.top + 4)}px` : "auto",
        left: align === "start" ? `${String(Math.max(4, box.left))}px` : "auto",
        right: align === "end" ? `${String(Math.max(4, width - box.right))}px` : "auto",
      });
    };
    place();
    const close = () => setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", close, true); };
  }, [open, layer, align, menu.anchor, setOpen]);
  useEffect(() => { if (!open) setAsking(undefined); else list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
  };
  const portal = (node: ReactNode) => layer === "window" ? createPortal(node, target) : node;
  return <div className="menu-button" ref={menu.anchor}>
    <button type="button" className="menu-button-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}><EllipsisIcon aria-hidden size={16} /></button>
    {open ? portal(<div className="menu-button-menu" data-align={align} data-layer={layer} role="menu" aria-label={label} ref={list} onKeyDown={move}>
      {commands.map((command, index) => command === "separator" ? <div key={`separator-${String(index)}`} className="menu-button-separator" role="separator" />
        : <button key={command.label} type="button" role="menuitem" className="menu-button-item" data-tone={command.tone} disabled={command.disabled}
          onClick={() => {
            if (command.confirm && asking !== command.label) { setAsking(command.label); return; }
            setOpen(false); command.onSelect();
          }}>{command.icon}{asking === command.label ? command.confirm : command.label}</button>)}
    </div>) : null}
  </div>;
}
