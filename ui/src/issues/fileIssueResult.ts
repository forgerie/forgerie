import { z } from "zod";

/** The parent's tool that files a GitHub issue itself (ADR 0002). */
export const FILE_ISSUE_TOOL = "file_issue";

// Mirror of FileIssueResultSchema in src/shared/fileIssues.ts: the details of a `file_issue` result.
const issueMatchSchema = z.object({ number: z.number().int().min(1), title: z.string(), state: z.enum(["open", "closed"]), url: z.string() });
export const fileIssueResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("duplicate"), repo: z.string(), matches: z.array(issueMatchSchema) }),
  z.object({ state: z.literal("created"), repo: z.string(), number: z.number().int().min(1), title: z.string(), url: z.string(),
    agentFiled: z.boolean(), labelWarning: z.string().optional() }),
]);
export type FileIssueResult = z.infer<typeof fileIssueResultSchema>;

const webAddress = z.url({ protocol: /^https?$/u });
/** An issue's address when it is a web address, so a link never runs anything else. */
export const issueLinkOf = (url: unknown): string | undefined => webAddress.safeParse(url).data;

/** One issue as the thread names it: its number and title, and its link when the address is a web address. An empty title is hidden. */
export interface IssueRef { number: number; title: string; href?: string }

// The server hides an outside contributor's title behind this sentence (titleOf in src/server/github/githubAgent.ts).
// It is words for the agent, not a title, so the thread names that issue by its number alone.
const HIDDEN_TITLE = /^\(title hidden: outside contributor (?:@\S+|a deleted user)\)$/u;
/**
 * What the thread shows of a `file_issue` result: the issue it filed, with the
 * reason it lacks the agent-filed label if it does, or the issues it refused
 * to duplicate.
 */
export type IssueOutcome =
  | { state: "created"; issue: IssueRef; labelWarning?: string }
  | { state: "duplicate"; matches: IssueRef[] };

const refOf = ({ number, title, url }: { number: number; title: string; url?: unknown }): IssueRef => {
  const href = issueLinkOf(url);
  return { number, title: HIDDEN_TITLE.test(title) ? "" : title, ...(href ? { href } : {}) };
};

/**
 * What a finished call did with an issue. A created issue counts only on a
 * successful call; a refused duplicate is an error result by design, so it
 * counts either way. Anything unreadable, or any other tool, is nothing.
 */
export function issueOutcomeOf({ toolName, isError, details }: { toolName: string; isError: boolean; details: unknown }): IssueOutcome | undefined {
  if (toolName !== FILE_ISSUE_TOOL) return undefined;
  const parsed = fileIssueResultSchema.safeParse(details);
  if (!parsed.success) return undefined;
  const result = parsed.data;
  if (result.state === "duplicate") return result.matches.length > 0 ? { state: "duplicate", matches: result.matches.map(refOf) } : undefined;
  if (isError) return undefined;
  return { state: "created", issue: refOf(result), ...(result.labelWarning ? { labelWarning: result.labelWarning } : {}) };
}

const refSchema = z.object({ number: z.number().int().min(1), title: z.string(), href: z.string().optional() });
const outcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("created"), issue: refSchema, labelWarning: z.string().optional() }),
  z.object({ state: z.literal("duplicate"), matches: z.array(refSchema).min(1) }),
]);
/** An issue outcome carried through the thread as a tool call's artifact, read back. Links are checked again. */
export function issueOutcomeFrom(value: unknown): IssueOutcome | undefined {
  const parsed = outcomeSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const ref = (issue: z.infer<typeof refSchema>) => refOf({ number: issue.number, title: issue.title, url: issue.href });
  const outcome = parsed.data;
  return outcome.state === "duplicate" ? { state: "duplicate", matches: outcome.matches.map(ref) }
    : { state: "created", issue: ref(outcome.issue), ...(outcome.labelWarning ? { labelWarning: outcome.labelWarning } : {}) };
}
