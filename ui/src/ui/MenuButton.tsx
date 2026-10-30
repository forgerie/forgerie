import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, EllipsisIcon } from "lucide-react";
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
  /** A readout at the row's end, such as the value the command changes. */
  value?: string | undefined;
  /** A second line under the label: what the command does, such as how many sessions it starts. */
  detail?: string | undefined;
  onSelect: () => void;
}

/**
 * Molecule: rare commands one tap away, behind a "more" button. The menu
 * opens under the button with full-size rows. Arrow keys move between rows;
 * Escape or a press outside closes it. A command with `confirm` asks again in
 * place before it runs. With `text`, the button shows words and a chevron, for
 * a menu that is a choice of its own, such as one action for every row of a
 * list; `heading` then says what the commands act on, and a command's `detail`
 * says what it does.
 */
export function MenuButton({ label, commands, align = "end", layer = "inline", text, shortText, heading }: {
  label: string; commands: readonly (MenuCommand | "separator")[];
  /** Words on the button, with a chevron, in place of the quiet "more" mark. */
  text?: string | undefined;
  /** Fewer words for a container under 24rem wide, such as "All 8" for "All 8 suggestions". */
  shortText?: string | undefined;
  /** A line at the menu's top that says what its commands act on. */
  heading?: string | undefined;
  /** Which edge of the button the menu lines up with. A button near the end of a row opens toward the start. */
  align?: "start" | "end";
  /**
   * `window` opens the menu at window level, so a scrolling list or a narrow pane never clips it: under the
   * button, or above it when the room below is short, and always at least 4px inside the window on both axes.
   * Use it for a button inside a list.
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
      // Measured window geometry, not theme decisions. The menu never comes closer than this to the window's edge.
      const EDGE = 4;
      // A menu taller than the window scrolls inside it.
      Object.assign(element.style, { maxBlockSize: `${String(room - 2 * EDGE)}px`, overflowY: "auto" });
      const height = element.offsetHeight;
      const menuWidth = element.offsetWidth;
      // Under the button while it fits, else above it while that fits, else wherever the window has room.
      const below = box.bottom + EDGE;
      const above = box.top - EDGE - height;
      const top = below + height + EDGE <= room ? below : above >= EDGE ? above : room - height - EDGE;
      const left = align === "start" ? box.left : box.right - menuWidth;
      const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max));
      Object.assign(element.style, {
        top: `${String(clamp(top, room - height - EDGE))}px`, bottom: "auto",
        left: `${String(clamp(left, width - menuWidth - EDGE))}px`, right: "auto",
      });
    };
    place();
    // A scroll under the menu moves the button away from it. A scroll inside a tall menu does not.
    const close = (event: Event) => { if (!(event.target instanceof Node && element.contains(event.target))) setOpen(false); };
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
  // Words, when given, stand in for the quiet mark; a narrow container shows the short words.
  const face = text === undefined ? <EllipsisIcon aria-hidden size={16} /> : <>
    {shortText === undefined ? text : <><span className="menu-button-text-long">{text}</span><span className="menu-button-text-short">{shortText}</span></>}
    <ChevronDownIcon aria-hidden size={14} />
  </>;
  return <div className="menu-button" ref={menu.anchor}>
    <button type="button" className="menu-button-trigger" data-text={text === undefined ? undefined : true} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}>{face}</button>
    {open ? portal(<div className="menu-button-menu" data-align={align} data-layer={layer} role="menu" aria-label={label} ref={list} onKeyDown={move}>
      {heading !== undefined ? <div className="menu-button-heading">{heading}</div> : null}
      {commands.map((command, index) => command === "separator" ? <div key={`separator-${String(index)}`} className="menu-button-separator" role="separator" />
        : itemOf(command, asking === command.label, () => {
            if (command.confirm && asking !== command.label) { setAsking(command.label); return; }
            setOpen(false); command.onSelect();
          }))}
    </div>) : null}
  </div>;
}

/** One command row: its icon, its label (or the words that confirm it), a detail line under it, and a readout at its end. */
function itemOf(command: MenuCommand, asking: boolean, onPress: () => void) {
  const name = asking ? command.confirm ?? command.label : command.label;
  // A detail or a readout joins the name with a pause, so a screen reader does not run them together.
  const extra = [command.detail, command.value].filter((part): part is string => part !== undefined);
  return <button key={command.label} type="button" role="menuitem" className="menu-button-item" data-tone={command.tone} data-detail={command.detail === undefined ? undefined : true}
    disabled={command.disabled} aria-label={extra.length === 0 ? undefined : [name, ...extra].join(", ")} onClick={onPress}>
    {command.icon}
    {command.detail === undefined ? name : <span className="menu-button-words"><span>{name}</span><span className="menu-button-detail">{command.detail}</span></span>}
    {command.value !== undefined ? <span className="menu-button-value">{command.value}</span> : null}
  </button>;
}
