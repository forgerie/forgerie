import { useState } from "react";
import { SuggestionsSheet } from "./SuggestionsSheet";
import type { Suggestion } from "./suggestionsApi";
import { answer } from "./fixtures/serverLike";
import { CHAT_SUGGESTIONS, DUPLICATE, FAILED, LAUNCH_ERROR, LAUNCH_ERROR_LOGGED, LONG, MODELS, NOW, STARTED_DONE, STARTED_NEEDS, look } from "./fixtures/suggestions";

export const name = "Backlog suggestions sheet";
export const note = "One chat's suggestions from the header: Open with File and File and act on each row, Filed with background sessions, Dismissed with Restore";

/** The sheet around records that answer each press the way the server does. */
function Stateful({ initial }: { initial: Suggestion[] | undefined }) {
  const [list, setList] = useState(initial);
  const [pending, setPending] = useState<Record<string, "file" | "file-and-act" | "restore">>({});
  const [said, setSaid] = useState<string>();
  const press = (id: string, kind: "file" | "file-and-act" | "restore") => {
    setPending({ ...pending, [id]: kind });
    setTimeout(() => {
      setList((current) => current?.map((record) => record.id === id ? answer(record, kind) : record));
      setPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    }, 400);
  };
  return <>
    <SuggestionsSheet suggestions={list} pending={pending} problems={{}} drafts={{}} look={look} knownModels={MODELS} now={NOW} actions={{
      onFile: (id) => press(id, "file"), onFileAndAct: (id) => press(id, "file-and-act"), onRestore: (id) => press(id, "restore"),
      onShow: (id) => setSaid(`Showing ${id} in the chat`), onOpenSession: (id) => setSaid(`Opened ${id}`), onOpenBacklog: () => setSaid("Opened the Backlog"),
      onRetry: () => setList(CHAT_SUGGESTIONS), onClose: () => setSaid("Closed") }} />
    {said ? <p>{said}</p> : null}
  </>;
}
export default function Collected() { return <Stateful initial={CHAT_SUGGESTIONS} />; }
export function NothingOpen() { return <Stateful initial={CHAT_SUGGESTIONS.filter((record) => record.state.kind !== "open")} />; }
export function Trouble() { return <Stateful initial={[FAILED, DUPLICATE, LAUNCH_ERROR, LAUNCH_ERROR_LOGGED, STARTED_NEEDS, STARTED_DONE]} />; }
export function Many() {
  return <Stateful initial={[LONG, ...Array.from({ length: 14 }, (_, index) => ({ ...CHAT_SUGGESTIONS[2]!, id: `sg-many-${String(index)}`,
    title: `Suggestion ${String(index + 1)}: keep the composer draft when a send fails twice` }))]} />;
}
export function Reading() { return <Stateful initial={undefined} />; }
