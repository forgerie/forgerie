import { ActionRunNoticeView } from "./ActionRunNoticeView";
import { actionRunNoticeOf } from "./actionRunNotice";
import { conclusionText, failedText, attemptText } from "./fixtures/notices";

export const name = "Action run notice";
export const note = "A run watcher wake in the thread: failed jobs, a new attempt, or the conclusion";

export default function JobsFailed() { return <ActionRunNoticeView notice={actionRunNoticeOf(failedText)} />; }
export function Finished() { return <ActionRunNoticeView notice={actionRunNoticeOf(conclusionText)} />; }
export function NewAttempt() { return <ActionRunNoticeView notice={actionRunNoticeOf(attemptText)} />; }
export function Unreadable() { return <ActionRunNoticeView notice={actionRunNoticeOf("The run watcher has news, but this client cannot read it.")} />; }
