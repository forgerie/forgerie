import { useEffect, useId, useRef, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import "./NumberedSections.css";

/** One section. With a number, it is a step of a process that a list elsewhere numbers the same way. */
export interface NumberedSection {
  key: string;
  number?: number | undefined;
  title: ReactNode;
  /** Where the process stands: a finished step's number is filled with ink, the one at work with live. */
  mark?: "done" | "current" | undefined;
  /** A step the reader added or removed, before the text catches up: added is in the added ink; removed is struck and faded. */
  change?: "added" | "removed" | undefined;
  /** One quiet line under the heading, such as what changed. */
  flag?: ReactNode;
  body: ReactNode;
}

/**
 * Molecule: a document in sections, each under its own heading, with an optional overview before the first. A
 * numbered heading carries its number in a ring, so the document and a numbered list beside it read as one. A
 * `target` scrolls its section to the top of the scroller (at once when the reader asked for less motion); while the
 * reader scrolls, `onInView` names the last numbered section whose heading passed the top 40% of the scroller.
 */
export function NumberedSections({ overview, sections, target, onInView }: {
  overview?: ReactNode;
  sections: readonly NumberedSection[];
  /** The section to bring into view. A new `at` brings it again. */
  target?: { key: string; at: number } | undefined;
  onInView?: ((key: string | undefined) => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const find = (key: string) => root.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(key)}"]`) ?? undefined;
  useEffect(() => {
    if (target === undefined) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    find(target.key)?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [target?.key, target?.at]);
  const numbered = sections.filter((section) => section.number !== undefined && section.change !== "removed").map((section) => section.key);
  const keys = numbered.join("\n");
  useEffect(() => {
    const node = root.current;
    if (onInView === undefined || node === null) return undefined;
    const onScroll = (event: Event) => {
      const box = event.target;
      if (!(box instanceof HTMLElement) || !box.contains(node)) return;
      const line = box.getBoundingClientRect().top + box.clientHeight * 0.4;
      onInView(keys.split("\n").filter((key) => (find(key)?.getBoundingClientRect().top ?? Infinity) <= line).at(-1));
    };
    node.ownerDocument.addEventListener("scroll", onScroll, true);
    return () => node.ownerDocument.removeEventListener("scroll", onScroll, true);
  }, [keys, onInView]);
  return <div ref={root} className="numbered-sections">
    {overview !== undefined && overview !== null && <div className="numbered-sections-overview">{overview}</div>}
    {sections.map((section, index) => <section key={section.key} className="numbered-sections-section" data-section={section.key}
      data-mark={section.mark} data-change={section.change} aria-labelledby={`${id}-${String(index)}`}>
      <h2 className="numbered-sections-heading" id={`${id}-${String(index)}`}>
        {section.number !== undefined && section.change !== "removed" && <span className="numbered-sections-number" aria-label={`Step ${String(section.number)}${
          section.mark === "done" ? ", done" : section.mark === "current" ? ", at work" : ""}`}>
          {section.mark === "done" ? <CheckIcon aria-hidden /> : section.number}</span>}
        <span className="numbered-sections-title">{section.title}</span>
      </h2>
      {section.flag !== undefined && section.flag !== null && <p className="numbered-sections-flag">{section.flag}</p>}
      <div className="numbered-sections-body">{section.body}</div>
    </section>)}
  </div>;
}
