import { ChildAgentsOpener } from "./ChildAgentsOpener";
import { CHILDREN } from "./fixtures/children";

export const name = "Child agents opener";
export const note = "The header control that opens a session's child agents";

export default function QuestionWaiting() {
  return <ChildAgentsOpener children={CHILDREN} onOpen={() => {}} />;
}
export function Working() {
  return <ChildAgentsOpener children={CHILDREN.map((child) => ({ ...child, questions: [] }))} onOpen={() => {}} />;
}
export function AllIdle() {
  return <ChildAgentsOpener children={CHILDREN.map((child) => ({ ...child, busy: false, questions: [] }))} onOpen={() => {}} />;
}
