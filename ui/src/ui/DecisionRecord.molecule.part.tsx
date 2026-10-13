import { useState } from "react";
import { DecisionRecord } from "./DecisionRecord";

export const name = "Decision record";
export const note = "One decision made without the reader, as a log row";

export default function Standing() {
  const [pressed, setPressed] = useState(false);
  return <ul>
    <DecisionRecord subject="parent" phrase="answered a question" time="4m" question="Should the CSV include archived runs?"
      choice="No, only active runs." reason="The contract lists active runs only, and the task says nothing about archived ones."
      action={{ label: "Overturn", pressed, onPress: () => setPressed(!pressed) }} />
  </ul>;
}
export function Flagged() {
  return <ul>
    <DecisionRecord subject="parent" phrase="guessed" time="12m" flag="Flagged guess" question="The spec says both “newest first” and “group by stage”. Which wins?"
      choice="Newest first, with the stage as a label on each row." reason="Grouping hides the order the reader asked to scan."
      action={{ label: "Overturn", onPress: () => undefined }} />
  </ul>;
}
export function Overturned() {
  return <ul>
    <DecisionRecord subject="parent" phrase="guessed" status="Overturned" time="1h" flag="Flagged guess, overturned"
      question="The spec says both “newest first” and “group by stage”. Which wins?"
      choice="Newest first, with the stage as a label on each row." reason="Grouping hides the order the reader asked to scan."
      correction={{ label: "you", time: "3m", text: "Group by stage. Inside each stage, newest first." }} />
  </ul>;
}
export function LongWords() {
  return <ul>
    <DecisionRecord subject="design-engineer-with-a-long-name" phrase="answered a question" time="2d"
      question="Use src/server/sessions/durableDecisionsRepositoryAdapterForTheLongPathCase.ts or keep it inline in the routes file?"
      choice="Keep it inline. A second file for forty lines costs more than it saves when the routes already own the reads, the writes, and the event."
      reason="The routes file is 300 lines; the adapter adds an import cycle." action={{ label: "Overturn", disabled: true, onPress: () => undefined }} />
  </ul>;
}
