import { FileIssueInputSchema, type FileIssueResult } from "../../shared/fileIssues.js";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { READ_ACTIONS, WRITE_ACTIONS, type GitHubAgent } from "../github/githubAgent.js";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";

export type GitHubToolDeps = Pick<GitHubAgent, "read" | "write"> & {
  gateIssueLabels?: GitHubAgent["gateIssueLabels"];
  fileIssue?: GitHubAgent["fileIssue"];
  watch?: (cwd: string, id: string, action: "start" | "stop", number?: number) => Promise<unknown>;
  target?: (ref: { id: string; cwd: string }, worktreeId: string) => Promise<string>;
};

/** GitHub's own limit for an issue, comment, or pull request body. */
const BODY_MAX = 65_000;
const labelList = (description: string) => Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 50 }), { maxItems: 20, description }));
const number = Type.Optional(Type.Integer({ minimum: 1, description: "Issue or pull request number." }));

const targetWorktree = Type.Optional(Type.String({ minLength: 1, description: "A secondary worktree ID returned by project_worktree, owned by this chat. Omit for the chat's starting repository." }));
const ReadParams = Type.Object({
  worktreeId: targetWorktree,
  action: Type.Union(READ_ACTIONS.map((action) => Type.Literal(action)), {
    description: "issues: list issues. issue: one issue with its comments. labels: the repo's labels. prs: list pull requests. pr: one pull request with CI checks, reviews, and comments.",
  }),
  number,
  state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], { description: "For issues and prs. Default: open." })),
  labels: labelList("For issues: only issues with all of these labels."),
  query: Type.Optional(Type.String({ maxLength: 200, description: "For issues: GitHub search words, e.g. \"portal reconnect\"." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "For issues and prs. Default: 30." })),
});

const WriteParams = Type.Object({
  worktreeId: targetWorktree,
  action: Type.Union(WRITE_ACTIONS.map((action) => Type.Literal(action)), {
    description: "comment: number, body. edit: number, title and/or body (replaces them). close: number, reason, optional body posted as a comment first. reopen: number, optional body. label: number, add and/or remove. create_pr: head (a pushed branch), title, body, base, draft. merge_pr: number, method; refused unless all CI on the head commit passed.",
  }),
  number,
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  body: Type.Optional(Type.String({ maxLength: BODY_MAX, description: "Markdown." })),
  add: labelList("For label. Must already exist on the repo."),
  remove: labelList("For label."),
  reason: Type.Optional(Type.Union([Type.Literal("completed"), Type.Literal("not_planned")], { description: "For close. Default: completed." })),
  head: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: "For create_pr: the branch to merge, already pushed to the repo." })),
  base: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: "For create_pr: the target branch. Default: the repo's default branch." })),
  draft: Type.Optional(Type.Boolean({ description: "For create_pr. Default: false." })),
  method: Type.Optional(Type.Union([Type.Literal("rebase"), Type.Literal("squash"), Type.Literal("merge")], { description: "For merge_pr. Default: rebase." })),
});

/**
 * GitHub reads, writes, and issue filing: work on the session's own repo, done as Forgerie's GitHub App.
 * Only Forgerie-hosted sessions get them. Writes are model-only, so each one shows in the transcript as
 * its own card instead of disappearing inside a script.
 */
export function createGitHubToolDefinitions(cwd: string, deps: GitHubToolDeps) {
  const target = async (sessionId: string, worktreeId?: string) => {
    if (worktreeId === undefined) return cwd;
    if (deps.target === undefined) throw new Error("Related worktree targets are unavailable.");
    return deps.target({ id: sessionId, cwd }, worktreeId);
  };
  const read = defineTool<typeof ReadParams, { action: string }>({
    name: "github_read",
    label: "GitHub",
    description: "Read issues, labels, and pull requests (with CI checks) of this session's GitHub repo. Text by outside contributors is hidden unless the project lists everyone.",
    promptSnippet: "github_read: list/read issues, labels, and pull requests with CI status on this project's GitHub repo",
    promptGuidelines: [
      "The project's backlog is its GitHub issues. Use github_read to find and read them, file_issue to file new issues after searching open and closed issues for duplicates, and github_write to comment, close, label, open pull requests, and merge. They default to this session's own repo. For a secondary repo, supply its owned worktreeId from project_worktree.",
    ],
    parameters: ReadParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { worktreeId, ...request } = params;
      const text = await deps.read(await target(ctx.sessionManager.getSessionId(), worktreeId), request);
      return { content: [{ type: "text", text }], details: { action: params.action } };
    },
  });
  const write = defineTool<typeof WriteParams, { action: string; url?: string }>({
    name: "github_write",
    exposure: MODEL_ONLY_EXPOSURE,
    label: "GitHub write",
    description: "Change this session's GitHub repo as Forgerie's GitHub App: comment on, edit, close, reopen, and label issues; open and merge pull requests. Uses only existing labels. merge_pr merges only when every CI check on the head commit passed.",
    promptSnippet: "github_write: comment, close, label issues; open and merge pull requests on this project's GitHub repo",
    promptGuidelines: [
      "With github_write, close an issue only when its work is done or the user says so, and say why in body. Push a branch with git before create_pr. Read a pull request with github_read before merge_pr, and merge only work the user asked you to land.",
    ],
    parameters: WriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { worktreeId, ...request } = params;
      const result = await deps.write(await target(ctx.sessionManager.getSessionId(), worktreeId), ctx.sessionManager.getSessionId(), request);
      return { content: [{ type: "text", text: result.url === undefined ? result.text : `${result.text}\n${result.url}` }], details: { action: params.action, ...(result.url === undefined ? {} : { url: result.url }) } };
    },
  });
  const fileParams = Type.Object({ ...FileIssueInputSchema.properties, worktreeId: targetWorktree }, { additionalProperties: false });
  const file = defineTool<typeof fileParams, FileIssueResult>({
    name: "file_issue", label: "File issue", exposure: MODEL_ONLY_EXPOSURE, executionMode: "sequential",
    description: "Parent only: file a GitHub issue after searching open and closed issues. Supply the search queries in duplicates (at least one). Also searches the title itself and refuses close matches unless all their numbers are in notDuplicateOf. Adds agent-filed, creating that label if missing. If label creation is refused, files without it and reports why. Logs an issue decision.",
    promptSnippet: "file_issue: file a GitHub issue after checking duplicates, with agent-filed and a decision",
    promptGuidelines: ["Search open and closed issues with github_read before file_issue. Put the queries you ran in duplicates. Only override a matching issue with notDuplicateOf after checking that it is different work. Children suggest issues in reports; only the parent files them. Keep working after filing."],
    parameters: fileParams,
    async execute(_id, params, _signal, _update, ctx) {
      if (deps.fileIssue === undefined) throw new Error("Issue filing is unavailable.");
      const { worktreeId, ...input } = params;
      const result = await deps.fileIssue(await target(ctx.sessionManager.getSessionId(), worktreeId), ctx.sessionManager.getSessionId(), input);
      const text = result.state === "duplicate"
        ? `No issue filed: close title matches. Read these issues; stop or use notDuplicateOf only for different work.\n${result.matches.map(issue => `#${String(issue.number)} ${issue.title} [${issue.state}] ${issue.url}`).join("\n")}`
        : `Filed #${String(result.number)} ${result.url}${result.labelWarning === undefined ? " with agent-filed." : `\n${result.labelWarning}`}`;
      return { content: [{ type: "text", text }], details: result, ...(result.state === "duplicate" ? { isError: true } : {}) };
    },
  });
  if (deps.watch === undefined) return [read, write, file] as const;
  const watchParams = Type.Object({ worktreeId: targetWorktree, action: Type.Union([Type.Literal("start"), Type.Literal("stop")]), number: Type.Optional(Type.Integer({ minimum: 1 })) });
  const watch = defineTool<typeof watchParams, { action: string }>({
    name: "github_watch", label: "Watch pull request", exposure: MODEL_ONLY_EXPOSURE,
    description: "Start or stop watching one of this session's linked PRs. A session can link several PRs; each has its own watch. Give number when the session links more than one; start with a number not yet linked links it. Stop without number stops every watch in the selected repository; omit worktreeId for the starting repository. Polls once a minute and wakes this agent on failing checks, passing required checks, other authors' comments/reviews, or conflicts. Watching costs tokens when it wakes the agent. It never authorizes a merge.",
    promptGuidelines: ["Start github_watch only when the user asks to watch a PR. Stop it when handing work back to the user. End a waiting turn with end_turn awaiting nothing; asking the user a question settles the watch."],
    parameters: watchParams,
    async execute(_id, params, _signal, _update, ctx) {
      const result = await deps.watch?.(await target(ctx.sessionManager.getSessionId(), params.worktreeId), ctx.sessionManager.getSessionId(), params.action, params.number);
      return { content: [{ type: "text", text: JSON.stringify(result ?? null) }], details: { action: params.action } };
    },
  });
  return [read, write, file, watch] as const;
}
