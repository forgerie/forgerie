import { EventSentence } from "./EventSentence";

export const name = "Event sentence";
export const note = "One quiet event told as a sentence that wraps, with the thing it names and a way to it";

const FILED = "https://github.com/forgerie/forgerie/issues/143";
const CREATED = "https://github.com/forgerie/forgerie/issues/1204";
const LONG = "Session picker keeps a closed worktree's sessions in the list after the worktree is removed, and opening one shows an empty transcript with no way back except a reload of the whole app";

export default function Linked() {
  return <EventSentence tone="positive">
    Filed <a href={FILED} target="_blank" rel="noreferrer">
      #143 <strong>Retry after a failed send loses the composer draft</strong>
    </a>
  </EventSentence>;
}
export function Plain() {
  return <EventSentence tone="neutral">Proposed issue (old card): <strong>Show the card idea from the design review</strong> — dismissed</EventSentence>;
}
export function Hollow() {
  return <EventSentence tone="neutral" hollow>Proposed issue (old card): <strong>Retry after a failed send loses the composer draft</strong></EventSentence>;
}
export function LongWords() {
  return <EventSentence tone="positive">
    Proposed issue (old card): <strong>{LONG}</strong> — <a href={CREATED} target="_blank" rel="noreferrer">
      {"created #"}{1204}
    </a>
  </EventSentence>;
}
