import { EventLine } from "./EventLine";

export const name = "Event line";
export const note = "One quiet line for something that happened in a conversation";

export default function Finished() {
  return <EventLine tone="positive" subject="cpo-poc-build" phrase="succeeded in 12s" time="21:05"
    code="cd ~/code/cpo-poc && npm ci && npm run build" codeLabel="Command" facts={[{ label: "exit", value: "0" }, { label: "id", value: "proc_2482" }]} />;
}
export function Quoted() {
  return <EventLine tone="active" subject="caliper-dev" phrase="printed a watched line 3 times" time="21:04"
    quote={<>➜  Local:   <a href="http://localhost:5173/">http://localhost:5173/</a></>} facts={[{ label: "watched for", value: "Local:" }]} />;
}
export function Ended() {
  return <EventLine tone="neutral" hollow subject="caliper-dev" phrase="stopped (SIGTERM)" time="21:09" />;
}
export function LongSubject() {
  return <EventLine tone="positive" subject="a-very-long-background-job-name-that-keeps-going" phrase="succeeded in 1h 2m 3s" time="23:59" />;
}
