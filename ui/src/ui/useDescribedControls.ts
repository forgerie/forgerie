import { useLayoutEffect, type RefObject } from "react";

const CONTROLS = "input, textarea, select, button";
const FIELDS = "input, textarea, select";
/** The ids this hook added, so a control's own aria-describedby (such as a text box's hint) is kept. */
const ADDED = "data-field-describedby";
const INVALID = "data-field-invalid";

/**
 * System hook: ties the controls inside a field to the words that describe it, such as a hint and a problem, with
 * aria-describedby, and marks its text fields aria-invalid while there is a problem. A field wraps controls it does
 * not draw itself (a picker, a time box, a group of toggles), so it finds them in the DOM after each render.
 */
export function useDescribedControls(container: RefObject<HTMLElement | null>, describedBy: readonly (string | undefined)[], invalid: boolean): void {
  const ids = describedBy.filter((id): id is string => Boolean(id));
  const key = ids.join(" ");
  useLayoutEffect(() => {
    for (const control of container.current?.querySelectorAll<HTMLElement>(CONTROLS) ?? []) {
      const added = new Set((control.getAttribute(ADDED) ?? "").split(" ").filter(Boolean));
      const own = (control.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && !added.has(id));
      const all = [...key.split(" ").filter(Boolean), ...own];
      if (all.length) control.setAttribute("aria-describedby", all.join(" ")); else control.removeAttribute("aria-describedby");
      if (key) control.setAttribute(ADDED, key); else control.removeAttribute(ADDED);
      if (!control.matches(FIELDS)) continue;
      // Only the mark this hook set comes off, so a control's own aria-invalid stays.
      if (invalid) { control.setAttribute("aria-invalid", "true"); control.setAttribute(INVALID, ""); }
      else if (control.hasAttribute(INVALID)) { control.removeAttribute("aria-invalid"); control.removeAttribute(INVALID); }
    }
  });
}
