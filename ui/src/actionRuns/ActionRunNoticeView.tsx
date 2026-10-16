import { EventLine, type EventTone } from "../ui/EventLine";
import { noticePhrase, noticeSubject, noticeTone, type ActionRunNotice, type NoticeTone } from "./actionRunNotice";

const TONE: Record<NoticeTone, EventTone> = { failed: "negative", passed: "positive", active: "active", quiet: "neutral" };

/**
 * Shape: one run watcher wake in the thread, as one quiet line. The failed
 * jobs stay in view under it; the text the agent read opens on request.
 */
export function ActionRunNoticeView({ notice }: { notice: ActionRunNotice }) {
  const tone = noticeTone(notice);
  const facts = [
    ...notice.repo ? [{ label: "repository", value: notice.repo }] : [],
    ...notice.attempt === undefined ? [] : [{ label: "attempt", value: String(notice.attempt) }],
  ];
  return <EventLine tone={TONE[tone]} hollow={tone === "quiet"} subject={noticeSubject(notice)} phrase={noticePhrase(notice)} facts={facts}
    quote={notice.failedJobs.length > 0 ? notice.failedJobs.map((job) => job.name).join("\n") : undefined}
    detail={notice.url ? <p><a href={notice.url} target="_blank" rel="noreferrer">Open the run on GitHub</a></p> : undefined}
    code={notice.text} codeLabel="What the agent read" />;
}
