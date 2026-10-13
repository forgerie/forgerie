import { IssueProposalInputSchema, type IssueProposalInput, type IssueProposalOutcome } from "../../shared/issueProposals.js";
import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { canonicalBacklogRoot } from "../backlog/backlogScanner.js";
import { resolveBacklogConfig } from "../backlog/backlogConfig.js";
import type { BacklogConfig } from "../../shared/backlog.js";
import { apiHeaders, GITHUB_API, type Fetch, type GitHubApp } from "./githubApp.js";
import { originGitHubRepo } from "./githubRemote.js";
import type { GitHubAuthor, GitHubAuthorTrust } from "./githubTrust.js";
import { readGitHubPull, type GitHubPullSnapshot } from "./githubPullRead.js";

/** A GitHub request the agent can fix or report. The message says what happened and what to do. */
export class GitHubToolError extends Error {}

/** The repo a session works on, and whether its project lists text from everyone. */
export interface SessionRepo { slug: string; everyone: boolean }

export interface GitHubAgentDependencies {
  app: Pick<GitHubApp, "tokenFor" | "dropToken" | "status">;
  fetch: Fetch;
  trust: Pick<GitHubAuthorTrust, "judge">;
  /** Injected so tests need no checkout. */
  resolveRepo?: (cwd: string) => Promise<SessionRepo>;
  backlogConfig?: (root: string) => Promise<BacklogConfig>;
  onPullCreated?: (input: { id: string; cwd: string; repo: string; number: number }) => Promise<void>;
}

export const READ_ACTIONS = ["issues", "issue", "labels", "prs", "pr"] as const;
export const WRITE_ACTIONS = ["comment", "edit", "close", "reopen", "label", "create_pr", "merge_pr"] as const;
export interface ReadRequest {
  action: typeof READ_ACTIONS[number];
  number?: number; state?: "open" | "closed" | "all"; labels?: string[]; query?: string; limit?: number;
}
export interface WriteRequest {
  action: typeof WRITE_ACTIONS[number];
  number?: number; title?: string; body?: string; add?: string[]; remove?: string[];
  reason?: "completed" | "not_planned"; head?: string; base?: string; draft?: boolean; method?: "rebase" | "squash" | "merge";
}
export interface WriteResult { text: string; url?: string }

const user = Type.Union([Type.Object({ login: Type.String() }), Type.Null()]);
const LabelRef = Type.Union([Type.String(), Type.Object({ name: Type.String() })]);
const IssueSchema = Type.Object({
  number: Type.Integer(), title: Type.String(), body: Type.Union([Type.String(), Type.Null()]), state: Type.String(),
  html_url: Type.String(), user, author_association: Type.String(), labels: Type.Array(LabelRef),
  updated_at: Type.String(), comments: Type.Integer(), pull_request: Type.Optional(Type.Unknown()),
  state_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
const CommentSchema = Type.Object({ user, author_association: Type.String(), body: Type.Optional(Type.String()), created_at: Type.String() });
const LabelSchema = Type.Object({ name: Type.String(), description: Type.Union([Type.String(), Type.Null()]) });
const Branch = Type.Object({ ref: Type.String(), sha: Type.String() });
const PullSchema = Type.Object({
  number: Type.Integer(), title: Type.String(), body: Type.Union([Type.String(), Type.Null()]), state: Type.String(),
  html_url: Type.String(), user, author_association: Type.String(), draft: Type.Optional(Type.Boolean()), head: Branch, base: Branch,
  merged: Type.Optional(Type.Boolean()), mergeable: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  mergeable_state: Type.Optional(Type.String()), changed_files: Type.Optional(Type.Integer()),
  additions: Type.Optional(Type.Integer()), deletions: Type.Optional(Type.Integer()), labels: Type.Array(LabelRef),
});
const CheckRunsSchema = Type.Object({ total_count: Type.Integer(), check_runs: Type.Array(Type.Object({
  name: Type.String(), status: Type.String(), conclusion: Type.Union([Type.String(), Type.Null()]),
})) });
const StatusSchema = Type.Object({ state: Type.String(), statuses: Type.Array(Type.Object({ context: Type.String(), state: Type.String() })) });
const ReviewSchema = Type.Object({ user, state: Type.String() });
const RepoSchema = Type.Object({ default_branch: Type.String() });
const MergeSchema = Type.Object({ sha: Type.String(), merged: Type.Boolean() });
const SearchSchema = Type.Object({ total_count: Type.Integer(), items: Type.Array(Type.Unknown()) });
type Issue = Static<typeof IssueSchema>;

/** Check conclusions that let a merge go ahead. */
const PASSING = new Set(["success", "neutral", "skipped"]);
const MAX_LIMIT = 50;
/** Comments read with an issue or pull request. Older ones are counted, not shown. */
const MAX_COMMENTS = 100;

/**
 * GitHub work for agents in Forgerie sessions, done as Forgerie's GitHub App on the session's own repo.
 * Every text an author wrote passes the same trust rule as the backlog, so an outside contributor's words
 * reach the agent only when the project lists everyone. Writes cannot create labels, and a merge waits for
 * CI to pass on the exact commit it merges.
 */
export class GitHubAgent {
  private readonly resolveRepo: (cwd: string) => Promise<SessionRepo>;
  constructor(private readonly deps: GitHubAgentDependencies) { this.resolveRepo = deps.resolveRepo ?? ((cwd) => sessionRepo(cwd, deps.backlogConfig)); }

  repo(cwd: string): Promise<SessionRepo> { return this.resolveRepo(cwd); }

  async pull(cwd: string, number: number, annotations = false): Promise<GitHubPullSnapshot> {
    const repo = await this.resolveRepo(cwd);
    const app = this.deps.app.status();
    return readGitHubPull(repo, this.caller(repo.slug), this.deps.trust, app.state === "configured" ? `${app.app.slug}[bot]` : undefined, number, annotations);
  }

  async mergePull(cwd: string, number: number, headSha: string, method: "rebase" | "squash" | "merge", expectedRepo: string): Promise<WriteResult> {
    const repo = await this.resolveRepo(cwd);
    if (repo.slug.toLowerCase() !== expectedRepo.toLowerCase()) throw new GitHubToolError("The repository changed after confirmation. Refresh and confirm again.");
    return this.merge(this.caller(repo.slug), number, method, headSha);
  }

  async read(cwd: string, request: ReadRequest): Promise<string> {
    const repo = await this.resolveRepo(cwd);
    const call = this.caller(repo.slug);
    const limit = Math.min(Math.max(request.limit ?? 30, 1), MAX_LIMIT);
    switch (request.action) {
      case "issues": return this.listIssues(repo, call, request, limit);
      case "issue": return this.showIssue(repo, call, required(request.number, "number", "issue"));
      case "labels": {
        const labels = await call.get("/labels?per_page=100", Type.Array(LabelSchema), "Issues: read");
        return labels.length === 0 ? `${repo.slug} has no labels.` : [`Labels on ${repo.slug}:`, ...labels.map((label) => `- ${label.name}${label.description === null || label.description === "" ? "" : ` — ${label.description}`}`)].join("\n");
      }
      case "prs": {
        const state = request.state ?? "open";
        const pulls = await call.get(`/pulls?state=${state}&per_page=${String(limit)}&sort=updated&direction=desc`, Type.Array(PullSchema), "Pull requests: read");
        const trusted = await this.judge(repo, call, pulls.map(authorOf));
        if (pulls.length === 0) return `No ${state === "all" ? "" : `${state} `}pull requests on ${repo.slug}.`;
        return pulls.map((pull) => `#${String(pull.number)}${pull.draft === true ? " [draft]" : ""} ${titleOf(pull, trusted)} (${pull.head.ref} → ${pull.base.ref}) by ${who(pull.user)}`).join("\n");
      }
      case "pr": return this.showPull(repo, call, required(request.number, "number", "pr"));
    }
  }

  /** Resolve the proposal once. Creation uses this pinned repo, not a later remote or config. */
  async prepareIssue(cwd: string, input: IssueProposalInput): Promise<string> {
    if (!Check(IssueProposalInputSchema, input) || input.title.trim() === "") throw new GitHubToolError("Invalid issue proposal title, body, or labels.");
    const repo = await this.resolveRepo(cwd);
    const call = this.caller(repo.slug);
    await call.get("", RepoSchema, "Metadata: read");
    await this.requireLabels(call, input.labels ?? []);
    return repo.slug;
  }

  /** Browser-confirmed creation only. Not an action of github_write. */
  async createIssue(repo: string, sessionId: string, input: IssueProposalInput): Promise<Extract<IssueProposalOutcome, { state: "created" }>> {
    if (!Check(IssueProposalInputSchema, input) || input.title.trim() === "") throw new GitHubToolError("Invalid issue proposal title, body, or labels.");
    const call = this.caller(repo);
    await this.requireLabels(call, input.labels ?? []);
    const issue = await call.send("POST", "/issues", { title: input.title, body: `${input.body}\n\n<!-- forgerie-session: ${sessionId} -->`, labels: input.labels ?? [] }, IssueSchema, "Issues: write");
    return { state: "created", number: issue.number, title: issue.title, url: issue.html_url };
  }

  async write(cwd: string, sessionId: string, request: WriteRequest): Promise<WriteResult> {
    const repo = await this.resolveRepo(cwd);
    const call = this.caller(repo.slug);
    const signed = (body: string) => `${body}\n\n<!-- forgerie-session: ${sessionId} -->`;
    const number = () => required(request.number, "number", request.action);
    if (!WRITE_ACTIONS.includes(request.action)) throw new GitHubToolError("Unknown github_write action. Use propose_issue for new issues; the user decides.");
    switch (request.action) {
      case "comment": {
        const comment = await call.send("POST", `/issues/${String(number())}/comments`, { body: signed(required(request.body, "body", "comment")) }, Type.Object({ html_url: Type.String() }), "Issues: write");
        return { text: `Commented on #${String(number())}.`, url: comment.html_url };
      }
      case "edit": {
        if (request.title === undefined && request.body === undefined) throw new GitHubToolError("edit needs a title, a body, or both.");
        const issue = await call.send("PATCH", `/issues/${String(number())}`, { ...(request.title === undefined ? {} : { title: request.title }), ...(request.body === undefined ? {} : { body: signed(request.body) }) }, IssueSchema, "Issues: write");
        return { text: `Edited #${String(issue.number)}.`, url: issue.html_url };
      }
      case "close":
      case "reopen": {
        const closing = request.action === "close";
        if (request.body !== undefined) await call.send("POST", `/issues/${String(number())}/comments`, { body: signed(request.body) }, Type.Object({}), "Issues: write");
        const issue = await call.send("PATCH", `/issues/${String(number())}`, closing ? { state: "closed", state_reason: request.reason ?? "completed" } : { state: "open" }, IssueSchema, "Issues: write");
        return { text: closing ? `Closed #${String(issue.number)} as ${issue.state_reason ?? request.reason ?? "completed"}.` : `Reopened #${String(issue.number)}.`, url: issue.html_url };
      }
      case "label": {
        const add = request.add ?? [];
        const remove = request.remove ?? [];
        if (add.length === 0 && remove.length === 0) throw new GitHubToolError("label needs labels to add, to remove, or both.");
        await this.requireLabels(call, add);
        if (add.length > 0) await call.send("POST", `/issues/${String(number())}/labels`, { labels: add }, Type.Array(Type.Unknown()), "Issues: write");
        // A label the issue does not have is already removed.
        for (const name of remove) await call.remove(`/issues/${String(number())}/labels/${encodeURIComponent(name)}`, "Issues: write");
        const issue = await call.get(`/issues/${String(number())}`, IssueSchema, "Issues: read");
        return { text: `#${String(issue.number)} now has labels: ${labelsOf(issue).join(", ") || "none"}.`, url: issue.html_url };
      }
      case "create_pr": {
        const head = required(request.head, "head", "create_pr");
        const base = request.base ?? (await call.get("", RepoSchema, "Metadata: read")).default_branch;
        const pull = await call.send("POST", "/pulls", { title: required(request.title, "title", "create_pr"), head, base, body: signed(request.body ?? ""), draft: request.draft ?? false }, PullSchema, "Pull requests: write");
        try { await this.deps.onPullCreated?.({ id: sessionId, cwd, repo: repo.slug, number: pull.number }); }
        catch (error) { throw new GitHubToolError(`Opened PR #${String(pull.number)} at ${pull.html_url}, but could not save its session link: ${error instanceof Error ? error.message : String(error)}. Do not create another PR; link this one again.`); }
        return { text: `Opened pull request #${String(pull.number)} (${head} → ${base}).`, url: pull.html_url };
      }
      case "merge_pr": return this.merge(call, number(), request.method ?? "rebase");
    }
  }

  private async listIssues(repo: SessionRepo, call: Caller, request: ReadRequest, limit: number): Promise<string> {
    const state = request.state ?? "open";
    const labels = request.labels ?? [];
    let issues: Issue[];
    let total: number | undefined;
    if (request.query === undefined || request.query.trim() === "") {
      const query = `state=${state}&per_page=${String(MAX_LIMIT)}&sort=updated&direction=desc${labels.length === 0 ? "" : `&labels=${encodeURIComponent(labels.join(","))}`}`;
      // GitHub lists pull requests with issues; those belong to the prs action.
      issues = (await call.get(`/issues?${query}`, Type.Array(IssueSchema), "Issues: read")).filter((issue) => issue.pull_request === undefined).slice(0, limit);
    } else {
      const terms = [`repo:${repo.slug}`, "is:issue", ...(state === "all" ? [] : [`state:${state}`]), ...labels.map((label) => `label:"${label}"`), request.query.trim()];
      const found = await call.get(`/search/issues?q=${encodeURIComponent(terms.join(" "))}&per_page=${String(limit)}`, SearchSchema, "Issues: read", { absolute: true });
      issues = found.items.filter((item): item is Issue => Check(IssueSchema, item));
      total = found.total_count;
    }
    const trusted = await this.judge(repo, call, issues.map(authorOf));
    if (issues.length === 0) return `No ${state === "all" ? "" : `${state} `}issues on ${repo.slug} match.`;
    const lines = issues.map((issue) => `#${String(issue.number)}${state === "all" ? ` [${issue.state}]` : ""} ${titleOf(issue, trusted)}${labelsOf(issue).length === 0 ? "" : ` — ${labelsOf(issue).join(", ")}`}`);
    if (total !== undefined && total > issues.length) lines.push(`(${String(total - issues.length)} more match; narrow the query or raise limit.)`);
    return lines.join("\n");
  }

  private async showIssue(repo: SessionRepo, call: Caller, number: number): Promise<string> {
    const issue = await call.get(`/issues/${String(number)}`, IssueSchema, "Issues: read");
    if (issue.pull_request !== undefined) return this.showPull(repo, call, number);
    const comments = issue.comments === 0 ? [] : await call.get(`/issues/${String(number)}/comments?per_page=${String(MAX_COMMENTS)}`, Type.Array(CommentSchema), "Issues: read");
    const trusted = await this.judge(repo, call, [authorOf(issue), ...comments.map(authorOf)]);
    return [
      `#${String(issue.number)} ${titleOf(issue, trusted)}`,
      `State: ${issue.state}${issue.state_reason === null || issue.state_reason === undefined ? "" : ` (${issue.state_reason})`} · Labels: ${labelsOf(issue).join(", ") || "none"} · By ${who(issue.user)} · ${issue.html_url}`,
      "", textOf(issue, issue.body, trusted),
      ...commentLines(comments, issue.comments, trusted),
    ].join("\n");
  }

  private async showPull(repo: SessionRepo, call: Caller, number: number): Promise<string> {
    const pull = await call.get(`/pulls/${String(number)}`, PullSchema, "Pull requests: read");
    const [checks, comments, reviews] = await Promise.all([
      this.checks(call, pull.head.sha),
      call.get(`/issues/${String(number)}/comments?per_page=${String(MAX_COMMENTS)}`, Type.Array(CommentSchema), "Pull requests: read"),
      call.get(`/pulls/${String(number)}/reviews?per_page=100`, Type.Array(ReviewSchema), "Pull requests: read"),
    ]);
    const trusted = await this.judge(repo, call, [authorOf(pull), ...comments.map(authorOf)]);
    const latest = new Map<string, string>();
    for (const review of reviews) if (review.state !== "COMMENTED") latest.set(who(review.user), review.state);
    const state = pull.merged === true ? "merged" : pull.draft === true ? `${pull.state}, draft` : pull.state;
    return [
      `PR #${String(pull.number)} ${titleOf(pull, trusted)}`,
      `State: ${state} · ${pull.head.ref} → ${pull.base.ref} · head ${pull.head.sha.slice(0, 12)} · By ${who(pull.user)} · ${pull.html_url}`,
      `Mergeable: ${pull.mergeable === null || pull.mergeable === undefined ? "not computed yet" : String(pull.mergeable)} (${pull.mergeable_state ?? "unknown"}) · ${String(pull.changed_files ?? 0)} files, +${String(pull.additions ?? 0)} −${String(pull.deletions ?? 0)}`,
      `Reviews: ${latest.size === 0 ? "none" : [...latest].map(([name, verdict]) => `${name} ${verdict.toLowerCase()}`).join(", ")}`,
      `CI: ${checks.summary}`, ...checks.lines.map((line) => `  ${line}`),
      "", textOf(pull, pull.body, trusted),
      ...commentLines(comments, comments.length, trusted),
    ].join("\n");
  }

  /** Check runs and commit statuses on one commit, and whether together they allow a merge. */
  private async checks(call: Caller, sha: string): Promise<{ summary: string; lines: string[]; passed: boolean; blocker?: string }> {
    const [runs, status] = await Promise.all([
      call.get(`/commits/${sha}/check-runs?per_page=100`, CheckRunsSchema, "Checks: read"),
      call.get(`/commits/${sha}/status`, StatusSchema, "Commit statuses: read"),
    ]);
    const lines = [
      ...runs.check_runs.map((run) => `${run.name}: ${run.status === "completed" ? run.conclusion ?? "completed" : run.status}`),
      ...status.statuses.map((entry) => `${entry.context}: ${entry.state}`),
    ];
    const pending = runs.check_runs.filter((run) => run.status !== "completed").length + status.statuses.filter((entry) => entry.state === "pending").length;
    const failed = runs.check_runs.filter((run) => run.status === "completed" && !PASSING.has(run.conclusion ?? "")).length
      + status.statuses.filter((entry) => entry.state === "failure" || entry.state === "error").length;
    if (lines.length === 0) return { summary: "no checks ran on this commit", lines, passed: false, blocker: "No CI ran on this commit, so nothing shows it works. Merge it by hand if that is intended." };
    if (runs.total_count > runs.check_runs.length) return { summary: `${String(runs.total_count)} checks; only the first 100 were read`, lines, passed: false, blocker: "This commit has more than 100 checks; Forgerie read only 100, so it cannot say all passed." };
    if (failed > 0) return { summary: `${String(failed)} failed`, lines, passed: false, blocker: `${String(failed)} ${failed === 1 ? "check" : "checks"} failed.` };
    if (pending > 0) return { summary: `${String(pending)} still running`, lines, passed: false, blocker: `${String(pending)} ${pending === 1 ? "check is" : "checks are"} still running. Wait and try again.` };
    return { summary: `all ${String(lines.length)} passed`, lines, passed: true };
  }

  private async merge(call: Caller, number: number, method: "rebase" | "squash" | "merge", expectedHeadSha?: string): Promise<WriteResult> {
    const pull = await call.get(`/pulls/${String(number)}`, PullSchema, "Pull requests: read");
    const refuse = (reason: string): never => { throw new GitHubToolError(`Did not merge PR #${String(number)}: ${reason}`); };
    if (expectedHeadSha !== undefined && pull.head.sha !== expectedHeadSha) refuse("its head changed after confirmation. Read the PR and confirm again.");
    if (pull.merged === true) refuse("it is already merged.");
    if (pull.state !== "open") refuse("it is closed.");
    if (pull.draft === true) refuse("it is a draft. Mark it ready for review first.");
    if (pull.mergeable === false) refuse(`it conflicts with ${pull.base.ref}. Rebase the branch and push again.`);
    if (pull.mergeable === null || pull.mergeable === undefined) refuse("GitHub has not finished checking whether it merges cleanly. Try again in a few seconds.");
    const checks = await this.checks(call, pull.head.sha);
    if (!checks.passed) refuse(checks.blocker ?? "CI did not pass.");
    // `sha` makes GitHub refuse the merge if someone pushed after the checks above were read.
    const merged = await call.send("PUT", `/pulls/${String(number)}/merge`, { merge_method: method, sha: pull.head.sha }, MergeSchema, "Contents: write");
    if (!merged.merged) refuse("GitHub did not merge it.");
    return { text: `Merged PR #${String(number)} into ${pull.base.ref} by ${method}; ${pull.base.ref} is now at ${merged.sha.slice(0, 12)}. CI: ${checks.summary}.`, url: pull.html_url };
  }

  /** Labels must already exist: agents use the repo's label set and never grow it. */
  private async requireLabels(call: Caller, names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    const known = new Set((await call.get("/labels?per_page=100", Type.Array(LabelSchema), "Issues: read")).map((label) => label.name.toLowerCase()));
    const missing = names.filter((name) => !known.has(name.toLowerCase()));
    if (missing.length > 0) throw new GitHubToolError(`These labels do not exist on the repo: ${missing.join(", ")}. Use only existing labels (action "labels" lists them); agents do not create labels.`);
  }

  private async judge(repo: SessionRepo, call: Caller, authors: GitHubAuthor[]): Promise<(author: GitHubAuthor) => boolean> {
    if (repo.everyone) return () => true;
    return this.deps.trust.judge(repo.slug, await call.token(), authors);
  }

  private caller(slug: string): Caller {
    let token: string | undefined;
    const app = this.deps.app;
    const mint = async (): Promise<string> => {
      let granted;
      try { granted = await app.tokenFor(slug); } catch (error) { throw new GitHubToolError(`GitHub is unreachable: ${error instanceof Error ? error.message : String(error)}`); }
      if (!granted.ok) throw new GitHubToolError(granted.message);
      token = granted.token;
      return token;
    };
    const respond = async (method: string, path: string, body: unknown, permission: string, options: { missingOk?: boolean; absolute?: boolean }): Promise<Response> => {
      const url = options.absolute === true ? `${GITHUB_API}${path}` : `${GITHUB_API}/repos/${slug}${path}`;
      const attempt = async (): Promise<Response> => {
        const headers = { ...apiHeaders(token ?? await mint()), ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
        try { return await this.deps.fetch(url, { method, headers, signal: AbortSignal.timeout(30_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
        catch (error) { throw new GitHubToolError(`GitHub is unreachable: ${error instanceof Error ? error.message : String(error)}`); }
      };
      let response = await attempt();
      // A token keeps the permissions it was minted with for its whole hour. After the person grants the app
      // more, a refusal from the old token says nothing about the app, so one fresh token gets one more try.
      const stalePermissions = response.status === 403 && /not accessible by integration/iu.test(await response.clone().text().catch(() => ""));
      if (response.status === 401 || stalePermissions) { app.dropToken(slug); token = undefined; response = await attempt(); }
      if (options.missingOk === true && response.status === 404) return response;
      if (!response.ok) throw await this.refusal(response, slug, permission);
      return response;
    };
    const request = async <S extends TSchema>(method: string, path: string, body: unknown, schema: S, permission: string, options: { absolute?: boolean } = {}): Promise<Static<S>> => {
      const response = await respond(method, path, body, permission, options);
      const parsed: unknown = response.status === 204 ? {} : await response.json().catch(() => undefined);
      if (!Check(schema, parsed)) throw new GitHubToolError(`GitHub sent an unexpected answer for ${method} ${path.split("?")[0] ?? path}.`);
      return parsed;
    };
    return {
      token: async () => token ?? mint(),
      get: (path, schema, permission, options) => request("GET", path, undefined, schema, permission, options),
      send: (method, path, body, schema, permission) => request(method, path, body, schema, permission),
      graphql: (body, schema) => request("POST", "/graphql", body, schema, "Pull requests: read", { absolute: true }),
      remove: async (path, permission) => { await respond("DELETE", path, undefined, permission, { missingOk: true }); },
    };
  }

  private async refusal(response: Response, slug: string, permission: string): Promise<GitHubToolError> {
    const body: unknown = await response.json().catch(() => undefined);
    const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : "";
    const details = typeof body === "object" && body !== null && "errors" in body && Array.isArray(body.errors)
      ? body.errors.map((error: unknown) => typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : JSON.stringify(error)).join("; ")
      : "";
    const said = [message, details].filter(Boolean).join(": ");
    if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      return new GitHubToolError(`GitHub rate limit reached${reset > 0 ? `; it resets at ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : ""}. Wait before asking again.`);
    }
    if (response.status === 403 && /not accessible by integration/iu.test(message)) {
      const app = this.deps.app.status();
      const where = app.state === "configured" ? ` Grant it at https://github.com/settings/apps/${app.app.slug}/permissions, then accept the new permissions on the app's installation.` : "";
      return new GitHubToolError(`Forgerie's GitHub App may not do this on ${slug}: it needs "${permission}".${where} Tell the user; do not retry.`);
    }
    if (response.status === 404) return new GitHubToolError(`GitHub found nothing there on ${slug} (HTTP 404)${said === "" ? "" : `: ${said}`}. Check the number or name.`);
    return new GitHubToolError(`GitHub refused (HTTP ${String(response.status)})${said === "" ? "." : `: ${said}`}`);
  }
}

export interface Caller {
  token(): Promise<string>;
  graphql<S extends TSchema>(body: unknown, schema: S): Promise<Static<S>>;
  get<S extends TSchema>(path: string, schema: S, permission: string, options?: { absolute?: boolean }): Promise<Static<S>>;
  send<S extends TSchema>(method: string, path: string, body: unknown, schema: S, permission: string): Promise<Static<S>>;
  /** DELETE that treats "already gone" (404) as done. */
  remove(path: string, permission: string): Promise<void>;
}

/** The session's project repo: `backlog.github.repo` from the canonical checkout's config, else its github.com origin. */
async function sessionRepo(cwd: string, config?: (root: string) => Promise<BacklogConfig>): Promise<SessionRepo> {
  const root = await canonicalBacklogRoot(cwd);
  const backlog = config === undefined ? (await resolveBacklogConfig({ id: root }, root)).backlog : await config(root);
  const github = backlog.github;
  const slug = github?.repo ?? await originGitHubRepo(root);
  if (slug === undefined) throw new GitHubToolError("This session's project has no GitHub repo. Its origin remote is not on github.com, and .forgerie/config.json sets no backlog.github.repo.");
  return { slug, everyone: github?.authors === "all" };
}

function required<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) throw new GitHubToolError(`Action "${action}" needs "${field}".`);
  return value;
}
function authorOf(value: { user: { login: string } | null; author_association: string }): GitHubAuthor {
  return { login: value.user?.login, association: value.author_association };
}
function who(value: { login: string } | null): string { return value === null ? "a deleted user" : `@${value.login}`; }
function labelsOf(issue: { labels: Static<typeof LabelRef>[] }): string[] { return issue.labels.map((label) => typeof label === "string" ? label : label.name); }
interface Authored { user: { login: string } | null; author_association: string }
function titleOf(value: Authored & { title: string }, trusted: (author: GitHubAuthor) => boolean): string {
  return trusted(authorOf(value)) ? value.title : `(title hidden: outside contributor ${who(value.user)})`;
}
function textOf(value: Authored, body: string | null | undefined, trusted: (author: GitHubAuthor) => boolean): string {
  if (!trusted(authorOf(value))) return `(text hidden: written by outside contributor ${who(value.user)}. The project's backlog.github.authors setting decides this.)`;
  return body === null || body === undefined || body.trim() === "" ? "(no description)" : body;
}
function commentLines(comments: Static<typeof CommentSchema>[], total: number, trusted: (author: GitHubAuthor) => boolean): string[] {
  if (comments.length === 0) return [];
  const lines = ["", `Comments (${String(total)}):`];
  for (const comment of comments) lines.push("", `— ${who(comment.user)} at ${comment.created_at}:`, textOf(comment, comment.body, trusted));
  if (total > comments.length) lines.push("", `(${String(total - comments.length)} newer comments not shown.)`);
  return lines;
}
