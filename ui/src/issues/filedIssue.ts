import { z } from "zod";

/** The parent's tool that files a GitHub issue itself (ADR 0002). */
export const FILE_ISSUE_TOOL = "file_issue";

/**
 * Mirror of `FiledIssue` in src/shared/fileIssues.ts: the details of a
 * `file_issue` result that created an issue. A refused duplicate is an error
 * result with other details, so it never matches.
 */
export const filedIssueSchema = z.object({
  state: z.literal("created"), repo: z.string(), number: z.number().int().min(1), title: z.string(), url: z.string(),
  agentFiled: z.boolean(), labelWarning: z.string().optional(),
});
export type FiledIssue = z.infer<typeof filedIssueSchema>;

const webAddress = z.url({ protocol: /^https?$/u });
/** An issue's address when it is a web address, so a link never runs anything else. */
export const issueLinkOf = (url: unknown): string | undefined => webAddress.safeParse(url).data;

/** What the thread shows of a filed issue: its number and title, and its link when the address is a web address. */
export interface FiledIssueLine { number: number; title: string; href?: string }
const lineSchema = z.object({ number: z.number().int().min(1), title: z.string(), href: z.string().optional() });

/** The issue a finished call filed. Only a successful `file_issue` call with readable details counts. */
export function filedIssueOf({ toolName, isError, details }: { toolName: string; isError: boolean; details: unknown }): FiledIssueLine | undefined {
  if (isError || toolName !== FILE_ISSUE_TOOL) return undefined;
  const parsed = filedIssueSchema.safeParse(details);
  if (!parsed.success) return undefined;
  const href = issueLinkOf(parsed.data.url);
  return { number: parsed.data.number, title: parsed.data.title, ...(href ? { href } : {}) };
}

/** A filed issue carried through the thread as a tool call's artifact, read back. */
export function filedIssueLineOf(value: unknown): FiledIssueLine | undefined {
  const parsed = lineSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const href = issueLinkOf(parsed.data.href);
  return { number: parsed.data.number, title: parsed.data.title, ...(href ? { href } : {}) };
}
