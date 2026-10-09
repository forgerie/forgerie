import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import { useMenu } from "./useMenu";
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
export function MenuButton({ label, commands, align = "end" }: {
  label: string; commands: readonly (MenuCommand | "separator")[];
  /** Which edge of the button the menu lines up with. A button near the end of a row opens toward the start. */
  align?: "start" | "end";
}) {
  const menu = useMenu();
  const [asking, setAsking] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const { open, setOpen } = menu;
  useEffect(() => { if (!open) setAsking(undefined); else list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
  };
  return <div className="menu-button" ref={menu.anchor}>
    <button type="button" className="menu-button-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}><EllipsisIcon aria-hidden size={16} /></button>
    {open ? <div className="menu-button-menu" data-align={align} role="menu" aria-label={label} ref={list} onKeyDown={move}>
      {commands.map((command, index) => command === "separator" ? <div key={`separator-${String(index)}`} className="menu-button-separator" role="separator" />
        : <button key={command.label} type="button" role="menuitem" className="menu-button-item" data-tone={command.tone} disabled={command.disabled}
          onClick={() => {
            if (command.confirm && asking !== command.label) { setAsking(command.label); return; }
            setOpen(false); command.onSelect();
          }}>{command.icon}{asking === command.label ? command.confirm : command.label}</button>)}
    </div> : null}
  </div>;
}
