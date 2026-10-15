import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { SettingsInput } from "./settings/SettingsInput";
import { TextButton } from "./TextButton";
import "./ValueList.css";

/**
 * Molecule: a short list of typed values, such as names to allow. Each value has its own box and a Remove named for
 * it; a value with a problem says it under its box, and the box reads as invalid to a screen reader. With no values,
 * the empty text says what goes here. The add action puts a blank box at the end and moves focus into it; Remove
 * moves focus to the box that takes its place, or to the add action when none is left. At the limit, the add action
 * turns off. The values stack in one column at every width; a long value wraps its problem, not its box.
 */
export function ValueList({ values, problems = [], itemLabel, removeLabel, addLabel, empty, placeholder, limit = Infinity, disabled = false, onChange }: {
  /** The values as typed, blank ones included. */
  values: readonly string[];
  /** One entry per value: its problem, or undefined. */
  problems?: readonly (string | undefined)[];
  /** Names one box by its place, such as "Name 2". */
  itemLabel: (index: number) => string;
  /** Names one Remove by the value it removes, such as "Remove ada". The value comes trimmed, and can be blank. */
  removeLabel: (value: string) => string;
  addLabel: string;
  empty: ReactNode;
  placeholder?: string | undefined;
  /** The most values the list takes. */
  limit?: number;
  /** Locks every box, Remove, and the add action, such as while a save is in flight. */
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const own = useId();
  const list = useRef<HTMLDivElement>(null);
  /** The box to focus after the next render; -1 is the add action. */
  const focusNext = useRef<number>(undefined);
  const problemId = (index: number) => `${own}-problem-${String(index)}`;
  useLayoutEffect(() => {
    const boxes = [...list.current?.querySelectorAll<HTMLInputElement>(".value-list-entry input") ?? []];
    // SettingsInput takes no describing props, so a value's problem is tied to its box here. Words that a field
    // around the list ties to the box, such as its hint, stay.
    boxes.forEach((box, index) => {
      const others = (box.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && !id.startsWith(`${own}-problem-`));
      const ids = problems[index] ? [problemId(index), ...others] : others;
      if (ids.length) box.setAttribute("aria-describedby", ids.join(" ")); else box.removeAttribute("aria-describedby");
      if (problems[index]) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid");
    });
    const target = focusNext.current;
    focusNext.current = undefined;
    if (target !== undefined) (boxes[target] ?? list.current?.querySelector<HTMLButtonElement>(".value-list-add button"))?.focus();
  });
  const add = () => { focusNext.current = values.length; onChange([...values, ""]); };
  const remove = (index: number) => {
    const rest = values.filter((_, at) => at !== index);
    focusNext.current = rest.length === 0 ? -1 : Math.min(index, rest.length - 1);
    onChange(rest);
  };
  return <div className="value-list" ref={list}>
    {values.length === 0 ? <p className="value-list-empty">{empty}</p>
      : <ul className="value-list-rows">{values.map((value, index) => {
        const problem = problems[index];
        const name = removeLabel(value.trim());
        // A box is keyed by its place: its value is controlled, so a removal above it only moves values up.
        return <li className="value-list-row" key={index}>
          <div className="value-list-entry">
            <SettingsInput label={itemLabel(index)} value={value} placeholder={placeholder} disabled={disabled}
              onChange={(next) => onChange(values.map((entry, at) => at === index ? next : entry))} />
            <button type="button" className="value-list-remove" disabled={disabled} aria-label={name} title={name} onClick={() => remove(index)}><XIcon aria-hidden /></button>
          </div>
          {problem ? <p className="value-list-problem" id={problemId(index)}>{problem}</p> : null}
        </li>;
      })}</ul>}
    <div className="value-list-add"><TextButton label={addLabel} icon={<PlusIcon aria-hidden />} disabled={disabled || values.length >= limit} onPress={add} /></div>
  </div>;
}
