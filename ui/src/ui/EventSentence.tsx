import type { ReactNode } from "react";
import type { EventTone } from "./EventLine";
import "./EventSentence.css";

/**
 * Molecule: one quiet event told as a sentence, in the event line's grammar:
 * a tone dot, then words. Unlike an event line, the words wrap instead of
 * cutting off, so a name and a link in them stay whole at every width. The
 * host writes the sentence; a `<strong>` in it is the thing it names, and an
 * `<a>` is the way to that thing.
 */
export function EventSentence({ tone, hollow = false, children }: {
  tone: EventTone;
  /** Draws the dot as a ring: the thing ended without a verdict. */
  hollow?: boolean;
  children: ReactNode;
}) {
  return <p className="event-sentence" data-tone={tone} data-hollow={hollow || undefined}>
    <span className="event-sentence-dot" aria-hidden="true" />
    <span className="event-sentence-text">{children}</span>
  </p>;
}
