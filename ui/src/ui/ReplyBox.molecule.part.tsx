import { ReplyBox } from "./ReplyBox";

export const name = "Reply box";
export const note = "A short text field with send and an optional second action";

export default function WithStop() {
  return <ReplyBox label="Message ui" placeholder="Steer ui while it works" sendLabel="Send to ui"
    onSend={() => Promise.resolve()} secondary={{ label: "Stop", onPress: () => {} }} />;
}
export function SendOnly() {
  return <ReplyBox label="Message ui" placeholder="Give ui a new task" sendLabel="Send to ui" onSend={() => Promise.resolve()} />;
}
export function Disabled() {
  return <ReplyBox label="Message ui" placeholder="Reconnecting" sendLabel="Send to ui" disabled onSend={() => Promise.resolve()} />;
}
