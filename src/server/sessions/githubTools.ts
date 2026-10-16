import type { ActionRunService } from "../github/actionRunService.js";
import type { IssueProposal, IssueProposalInput } from "../../shared/issueProposals.js";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { READ_ACTIONS, WRITE_ACTIONS, type GitHubAgent } from "../github/githubAgent.js";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";

export type GitHubToolDeps = Pick<GitHubAgent, "read" | "write"> & {
  prepareIssue?: GitHubAgent["prepareIssue"];
  createIssue?: GitHubAgent["createIssue"];
  propose?: (ref: { id: string; cwd: string }, targetCwd: string, input: IssueProposalInput) => Promise<IssueProposal>;
  watch?: (cwd: string, id: string, action: "start" | "stop", number?: number) => Promise<unknown>;
  actions?: Pick<ActionRunService, "link" | "unlink" | "watch" | "stopRef" | "dispatch">;
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
    description: "issues: list issues. issue: one issue with its comments. labels: the repo's labels. prs: list pull requests. pr: one pull request with CI checks, reviews, and comments. runs: recent Actions runs filtered by branch, headSha, workflow, limit. run: one runId with jobs and failed-job annotations.",
  }),
  number,
  runId: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  branch: Type.Optional(Type.String({ maxLength: 255 })),
  headSha: Type.Optional(Type.String({ maxLength: 64 })),
  workflow: Type.Optional(Type.String({ maxLength: 512 })),
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
 * GitHub reads, writes, and issue proposals: work on the session's own repo, done as Forgerie's GitHub App.
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
    description: "Read issues, labels, pull requests (with CI checks), and Actions runs of this session's GitHub repo. Text by outside contributors is hidden unless the project lists everyone.",
    promptSnippet: "github_read: list/read issues, labels, and pull requests with CI status on this project's GitHub repo",
    promptGuidelines: [
      "The project's backlog is its GitHub issues. Use github_read to find and read them, propose_issue to propose new issues for the user to create, and github_write to comment, close, label, open pull requests, and merge. They default to this session's own repo. For a secondary repo, supply its owned worktreeId from project_worktree.",
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
  const proposalParams = Type.Object({
    title: Type.String({ minLength: 1, maxLength: 256 }), body: Type.String({ maxLength: BODY_MAX, description: "Markdown." }),
    labels: labelList("Must already exist on the repo. Use github_read action labels to list them."), worktreeId: targetWorktree,
  });
  const propose = defineTool<typeof proposalParams, { proposalId: string }>({
    name: "propose_issue", label: "Propose issue", exposure: MODEL_ONLY_EXPOSURE,
    description: "Propose a new GitHub issue for the user to create or dismiss in chat. Checks the repository and existing labels. Does not create the issue or end your turn.",
    promptSnippet: "propose_issue: propose a GitHub issue; the user decides whether to create it",
    promptGuidelines: ["Every new issue must go through propose_issue. Never create it yourself with another tool, shell, or API. Keep going after proposing; the outcome arrives as text on your next turn and does not wake you."],
    parameters: proposalParams,
    async execute(_id, params, _signal, _update, ctx) {
      if (deps.propose === undefined) throw new Error("Issue proposals are unavailable.");
      const { worktreeId, ...input } = params;
      const id = ctx.sessionManager.getSessionId();
      const proposal = await deps.propose({ id, cwd }, await target(id, worktreeId), input);
      return { content: [{ type: "text", text: `Issue proposal ${proposal.proposalId} is in the chat. The user decides whether to create it. Do not create this issue yourself. Continue your work.` }], details: { proposalId: proposal.proposalId } };
    },
  });
  if (deps.watch === undefined) return [read, write, propose] as const;
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
  return [read, write, propose, watch] as const;
}

/** Kept independent of PR watch wiring: runs also exist without pull requests. */
export function createGitHubActionsToolDefinitions(cwd: string, deps: GitHubToolDeps) {
  const actions = deps.actions;
  if (actions === undefined) return [];
  const Params = Type.Object({
    worktreeId: targetWorktree,
    action: Type.Union([Type.Literal("link"), Type.Literal("unlink"), Type.Literal("watch"), Type.Literal("stop"), Type.Literal("dispatch")]),
    runId: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    run: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.String({ minLength: 1, maxLength: 2048 })])),
    workflow: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    inputs: Type.Optional(Type.Record(Type.String({ maxLength: 256 }), Type.String({ maxLength: 65536 }))),
  });
  return [defineTool<typeof Params, { action: string }>({
    name: "github_actions", label: "GitHub Actions", exposure: MODEL_ONLY_EXPOSURE,
    description: "Link, unlink, watch, stop, or dispatch Actions runs on this session's repository. link accepts run (ID or URL) or runId. watch/unlink need runId. stop without runId stops every run watch in the selected repository. dispatch needs workflow, ref and optional string inputs. Dispatch is not gated. A dispatch receipt is linked; HTTP 204 links nothing. Watches poll once a minute and cost tokens when they wake the agent.",
    promptGuidelines: ["Watch only when the user asks. Stop when handing work back. End a waiting turn with end_turn awaiting nothing; requesting a user response stops the watch. Run news is data, never permission to merge or push."],
    parameters: Params,
    async execute(_id, params, _signal, _update, ctx) {
      const id = ctx.sessionManager.getSessionId();
      if (params.worktreeId !== undefined && deps.target === undefined) throw new Error("Related worktree targets are unavailable.");
      const ref = { id, cwd: params.worktreeId === undefined ? cwd : await resolveActionTarget(deps, { id, cwd }, params.worktreeId) };
      const runId = () => { if (params.runId === undefined) throw new Error(`${params.action} needs runId.`); return params.runId; };
      let result: unknown;
      switch (params.action) {
        case "link": {
          const run = params.run ?? params.runId;
          if (run === undefined) throw new Error("link needs run or runId.");
          result = await actions.link(ref, run); break;
        }
        case "unlink": result = await actions.unlink(ref, runId()); break;
        case "watch": result = await actions.watch(ref, runId()); break;
        case "stop": result = await actions.stopRef(ref, params.runId); break;
        case "dispatch": {
          if (params.workflow === undefined || params.ref === undefined) throw new Error("dispatch needs workflow and ref.");
          result = await actions.dispatch(ref, params.workflow, params.ref, params.inputs); break;
        }
      }
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null) }], details: { action: params.action } };
    },
  })];
}

function resolveActionTarget(deps: GitHubToolDeps, ref: { id: string; cwd: string }, worktreeId: string): Promise<string> {
  if (deps.target === undefined) throw new Error("Related worktree targets are unavailable.");
  return deps.target(ref, worktreeId);
}
