import { WorkflowOpener } from "./WorkflowOpener";

export const name = "Workflow opener";
export const note = "The header's way into saved workflows; it counts stops that wait on you";

export default function Idle() { return <WorkflowOpener waiting={0} running={false} onOpen={() => {}} />; }
export function Running() { return <WorkflowOpener waiting={0} running onOpen={() => {}} />; }
export function Waiting() { return <WorkflowOpener waiting={1} running onOpen={() => {}} />; }
