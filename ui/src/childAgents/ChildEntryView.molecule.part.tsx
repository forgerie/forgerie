import { ChildEntryView } from "./ChildEntryView";

export const name = "Child entry";
export const note = "What a child agent did, as a row in the parent's thread";

export default function Question() {
  return <ChildEntryView entry={{ kind: "question", questionId: "q:40", child: 21, childName: "ui", question: "Should the empty state show the last run, or stay blank?" }}
    onAnswer={() => Promise.resolve()} onOpen={() => {}} />;
}
/** The parent passed the question on: it would be irreversible. The card says what the parent would choose. */
export function Escalated() {
  return <ChildEntryView entry={{ kind: "question", questionId: "q:41", child: 22, childName: "build",
    question: "The rebase rewrote three pushed commits on feat/run-export-api. Force-push the branch?",
    escalation: { kind: "irreversible", guess: "Yes, with --force-with-lease", why: "only this worker has pushed to the branch, and the lease refuses if anyone else did." } }}
    onAnswer={() => Promise.resolve()} onOpen={() => {}} />;
}
export function Answered() {
  return <ChildEntryView entry={{ kind: "question", questionId: "q:40", child: 21, childName: "ui",
    question: "Should the empty state show the last run, or stay blank?", answer: "Show the last run." }} onOpen={() => {}} />;
}
export function Finished() {
  return <ChildEntryView entry={{ kind: "report", childName: "api", outcome: "answered",
    text: "Added GET /api/runs with an empty list for a new project.\n\nTests: 14 passed. Contract unchanged." }} />;
}
export function Failed() {
  return <ChildEntryView entry={{ kind: "report", childName: "api", outcome: "failed", text: "Provider returned 429 after 3 retries" }} />;
}
export function Steered() {
  return <ChildEntryView entry={{ kind: "note", child: 21, childName: "ui", action: "message", text: "Keep the old copy; only add the icon." }} />;
}
export function Stopped() {
  return <ChildEntryView entry={{ kind: "note", child: 21, childName: "ui", action: "stop", text: "" }} />;
}
