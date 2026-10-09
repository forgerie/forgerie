import { useState, type ReactNode } from "react";
import { AlertCard } from "../ui/AlertCard";
import { EventLine, type EventFact, type EventTone } from "../ui/EventLine";
import { eventPhrase, exitMeaning, type ProcessEvent } from "./processEvent";

const tones: Record<ProcessEvent["outcome"], EventTone> = { succeeded: "positive", failed: "negative", stopped: "neutral", matched: "active" };
const clock = (at: number | undefined) => at === undefined ? undefined
  : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
/** A matched line with its URLs made openable: a dev server's address is usually the point. */
function linked(line: string): ReactNode {
  return line.split(URL_PATTERN).map((piece, index) => index % 2 === 1
    ? <a key={index} href={piece} target="_blank" rel="noreferrer">{piece}</a> : piece);
}

type Output = { type: "closed" } | { type: "loading" } | { type: "shown"; text: string };

/**
 * Shape: one managed-process event in the thread. A failure is a card,
 * because it may need the reader; everything else is one line.
 */
export function ProcessEventView({ event, onLoadOutput }: {
  event: ProcessEvent;
  /** Recent output of the process. Absent where nothing can fetch it. */
  onLoadOutput?: (() => Promise<string>) | undefined;
}) {
  const [output, setOutput] = useState<Output>({ type: "closed" });
  const time = clock(event.at);
  const facts: EventFact[] = [
    ...event.exitCode === undefined ? [] : [{ label: "exit", value: String(event.exitCode) }],
    ...event.pattern === undefined ? [] : [{ label: "watched for", value: event.pattern }],
    ...event.stream === undefined ? [] : [{ label: "stream", value: event.stream }],
    { label: "id", value: event.id },
  ];

  if (event.outcome !== "failed") {
    return <EventLine tone={tones[event.outcome]} hollow={event.outcome === "stopped"} subject={event.name}
      phrase={eventPhrase(event)} time={time} facts={facts} code={event.command} codeLabel="Command"
      quote={event.matchedLine === undefined ? undefined : linked(event.matchedLine)} />;
  }

  async function toggle() {
    if (output.type === "shown") { setOutput({ type: "closed" }); return; }
    if (!onLoadOutput) return;
    setOutput({ type: "loading" });
    try {
      const text = await onLoadOutput();
      setOutput({ type: "shown", text: text === "" ? "The process wrote no output." : text });
    } catch (error) {
      setOutput({ type: "shown", text: `Could not load the output: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const meaning = exitMeaning(event.exitCode);
  return <AlertCard label={`Process ${event.name} failed`} title={`${event.name} failed`} time={time}
    code={event.command} codeLabel="Command"
    output={output.type === "shown" ? output.text : undefined} outputLabel={`Recent output of ${event.name}`}
    actions={onLoadOutput ? [{ label: output.type === "shown" ? "Hide output" : output.type === "loading" ? "Loading output…" : "Show output",
      disabled: output.type === "loading", onPress: () => { void toggle(); } }] : []}>
    {event.exitCode === undefined ? <p>{event.summary}</p> : <p>
      Exit code <strong>{event.exitCode}</strong>{event.duration ? ` after ${event.duration}` : ""}.{meaning ? ` ${meaning}` : ""}
    </p>}
  </AlertCard>;
}
