import { useState } from "react";
import { SuggestedInChats } from "./SuggestedInChats";
import type { Suggestion } from "./suggestionsApi";
import { answer } from "./fixtures/serverLike";
import { DUPLICATE, FAILED, LONG, NOW, suggestion } from "./fixtures/suggestions";

export const name = "Suggested in chats";
export const note = "The Backlog view's group of open suggestions from every chat, with File, File and act, and Show in chat";

const OPEN_EVERYWHERE: Suggestion[] = [
  suggestion("sg-b", { title: "Show the provider's close reason under a cut-off reply", createdAt: "2026-10-21T16:46:00Z" }),
  suggestion("sg-c", { title: "Add a shared fixture that drops the stream after the first tool call", createdAt: "2026-10-21T16:49:00Z" }),
  suggestion("sg-x", { title: "Keep the composer draft when a send fails twice", sessionId: "s-composer", sessionTitle: "Composer retries", createdAt: "2026-10-19T10:00:00Z" }),
];

/** The group around records that answer the way the server does: a filed record leaves the open list. */
function Stateful({ initial }: { initial: Suggestion[] }) {
  const [list, setList] = useState(initial);
  const [pending, setPending] = useState<Record<string, "file" | "file-and-act">>({});
  const [said, setSaid] = useState<string>();
  const press = (id: string, kind: "file" | "file-and-act") => {
    setPending({ ...pending, [id]: kind });
    setTimeout(() => {
      const record = list.find((entry) => entry.id === id);
      if (record) setSaid(`Filed: ${answer(record, kind).title}`);
      setList((current) => current.filter((entry) => entry.id !== id));
      setPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    }, 400);
  };
  return <>
    <SuggestedInChats suggestions={list} pending={pending} problems={{}} drafts={{}} now={NOW} actions={{
      onFile: (id) => press(id, "file"), onFileAndAct: (id) => press(id, "file-and-act"),
      onShow: (record) => setSaid(`Showing it in ${record.sessionTitle ?? "its chat"}`), onRetry: () => setList(OPEN_EVERYWHERE) }} />
    {said ? <p>{said}</p> : null}
  </>;
}
export default function Waiting() { return <Stateful initial={OPEN_EVERYWHERE} />; }
export function Trouble() { return <Stateful initial={[FAILED, DUPLICATE, LONG]} />; }
export function ReadFailed() {
  return <SuggestedInChats suggestions={undefined} readError="Forgerie answered 503." pending={{}} problems={{}} drafts={{}} now={NOW}
    actions={{ onFile: () => {}, onFileAndAct: () => {}, onShow: () => {}, onRetry: () => {} }} />;
}
