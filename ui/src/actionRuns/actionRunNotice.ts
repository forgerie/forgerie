/**
 * Actions run events in the transcript: `forgerie:action-run` custom
 * messages. The server's run watcher writes one each time it has news. The
 * news is one fenced JSON block; the text around it is what the agent read.
 * Pure: message text in, one line out.
 */
import { conclusionPhrase } from "./actionRunModel";

export const ACTION_RUN_NOTICE_TYPE = "forgerie:action-run";

export interface NoticeJob { id: string; name: string; state: string; url: string }
export interface ActionRunNotice {
  repo: string | undefined;
  runId: number | undefined;
  attempt: number | undefined;
  workflow: string | undefined;
  url: string | undefined;
  failedJobs: readonly NoticeJob[];
  /** The attempt that started since the last news, if one did. */
  newAttempt: number | undefined;
  conclusion: string | undefined;
  /** The full text the agent read. */
  text: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const string = (value: unknown) => typeof value === "string" && value !== "" ? value : undefined;
const integer = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : undefined;
const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

function newsOf(text: string): Record<string, unknown> | undefined {
  const fenced = /```json\n([\s\S]*?)\n```/u.exec(text)?.[1];
  if (!fenced) return undefined;
  try { return record(JSON.parse(fenced)); } catch { return undefined; }
}

export function actionRunNoticeOf(text: string): ActionRunNotice {
  const news = newsOf(text);
  const attempt = integer(news?.attempt);
  const failedJobs = (Array.isArray(news?.failedJobs) ? news.failedJobs : []).flatMap((value) => {
    const job = record(value);
    const name = string(job?.name);
    return job && name ? [{ id: string(job.id) ?? String(job.id ?? name), name, state: string(job.state) ?? "failed", url: string(job.url) ?? "" }] : [];
  });
  // `newAttempt` may be the attempt's number or a flag beside `attempt`.
  const newAttempt = integer(news?.newAttempt) ?? (news?.newAttempt === true ? attempt : undefined);
  return { repo: string(news?.repo), runId: integer(news?.runId), attempt, workflow: string(news?.workflow), url: string(news?.url),
    failedJobs, newAttempt, conclusion: string(news?.conclusion), text };
}

/** "CI #4812", or as much of it as the news carried. */
export function noticeSubject(notice: ActionRunNotice): string {
  const number = notice.runId === undefined ? undefined : `#${String(notice.runId)}`;
  if (notice.workflow && number) return `${notice.workflow} ${number}`;
  return notice.workflow ?? (number ? `Run ${number}` : "A workflow run");
}

/**
 * What happened, after the subject. A conclusion alone is a report; failed
 * jobs and a new attempt are what wakes the agent, so those lines say so.
 */
export function noticePhrase(notice: ActionRunNotice): string {
  const failed = notice.failedJobs.length;
  const clauses: string[] = [];
  if (notice.newAttempt !== undefined) clauses.push(`attempt ${String(notice.newAttempt)} started`);
  if (failed > 0) clauses.push(`${plural(failed, "job", "jobs")} failed`);
  const news = clauses.length > 0 ? `${clauses.join(", ")}.` : "";
  const woke = news ? " The agent was woken." : "";
  if (notice.conclusion) return `finished: ${conclusionPhrase(notice.conclusion)}.${news ? ` ${capital(news)}` : ""}${woke}`;
  return news ? `${news}${woke}` : "new activity. The agent was woken.";
}
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The one line the transcript shows: `CI #4812: 2 jobs failed. The agent was
 * woken.` or `Build SM8550 #4813 finished: success.`
 */
export function noticeSentence(notice: ActionRunNotice): string {
  const phrase = noticePhrase(notice);
  return phrase.startsWith("finished:") ? `${noticeSubject(notice)} ${phrase}` : `${noticeSubject(notice)}: ${phrase}`;
}

export type NoticeTone = "failed" | "passed" | "active" | "quiet";
/** The row's tone: a failure, a success, something still running, or an ending without a verdict. */
export function noticeTone(notice: ActionRunNotice): NoticeTone {
  if (notice.failedJobs.length > 0 || notice.conclusion === "failure" || notice.conclusion === "timed_out") return "failed";
  if (notice.conclusion === "success") return "passed";
  if (notice.conclusion === undefined) return "active";
  return "quiet";
}
