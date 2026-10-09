/**
 * Pull request events in the transcript: `forgerie:pull-request` custom
 * messages. The server writes one when the watcher wakes the agent, and one
 * when the user merges from the panel. Pure: message in, one line out.
 */
export type PullNotice =
  | { kind: "merged"; number: number; base: string; method: string; headSha: string; text: string }
  | { kind: "activity"; number: number | undefined; line: string; text: string };

export const PULL_NOTICE_TYPE = "forgerie:pull-request";
const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** The watcher's notice carries its news as one fenced JSON block. */
function newsOf(text: string): Record<string, unknown> | undefined {
  const fenced = /```json\n([\s\S]*?)\n```/u.exec(text)?.[1];
  if (!fenced) return undefined;
  try { return record(JSON.parse(fenced)); } catch { return undefined; }
}

/** What woke the agent, most urgent first, as one short clause list. */
function activityLine(news: Record<string, unknown> | undefined): string {
  if (!news) return "new activity";
  const parts: string[] = [];
  const failed = Array.isArray(news.failedChecks) ? news.failedChecks.length : 0;
  if (failed > 0) parts.push(`${plural(failed, "check", "checks")} failed`);
  if (news.conflict === true) parts.push("conflicts with its base");
  const remarks = (Array.isArray(news.remarks) ? news.remarks.length : 0) + (typeof news.omittedRemarks === "number" ? news.omittedRemarks : 0);
  if (remarks > 0) parts.push(plural(remarks, "new comment", "new comments"));
  if (news.checksPassed === true) parts.push("checks passed");
  return parts.length > 0 ? parts.join(", ") : "new activity";
}

export function pullNoticeOf(text: string, details: unknown): PullNotice {
  const facts = record(details);
  if (facts?.kind === "merged" && typeof facts.number === "number") {
    return { kind: "merged", number: facts.number, base: typeof facts.base === "string" ? facts.base : "its base",
      method: typeof facts.method === "string" ? facts.method : "rebase", headSha: typeof facts.headSha === "string" ? facts.headSha : "", text };
  }
  const news = newsOf(text);
  const number = typeof news?.number === "number" ? news.number : Number(/#(\d+)/u.exec(text)?.[1]) || undefined;
  return { kind: "activity", number, line: activityLine(news), text };
}

/** The one line the transcript shows. */
export function noticeSentence(notice: PullNotice): string {
  if (notice.kind === "merged") {
    const how = notice.method === "squash" ? "squashed" : notice.method === "merge" ? "merged" : "rebased";
    return `You merged #${String(notice.number)} into ${notice.base} (${how}) from the pull request panel.`;
  }
  return `${notice.number === undefined ? "A pull request" : `#${String(notice.number)}`}: ${notice.line}. The agent was woken.`;
}
