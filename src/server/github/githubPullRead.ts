import { Type, type Static, type TSchema } from "typebox";
import type { PullCheck, PullRemark, PullRequest } from "../../shared/pullRequests.js";
import type { Caller, SessionRepo } from "./githubAgent.js";
import type { GitHubAuthorTrust } from "./githubTrust.js";

const User = Type.Union([Type.Object({ login: Type.String() }), Type.Null()]);
const Author = { user: User, author_association: Type.String() };
const Pull = Type.Object({ ...Author, number: Type.Integer(), title: Type.String(), html_url: Type.String(), state: Type.String(), draft: Type.Boolean(), merged: Type.Boolean(),
  head: Type.Object({ ref: Type.String(), sha: Type.String() }), base: Type.Object({ ref: Type.String() }), updated_at: Type.String(),
  mergeable: Type.Union([Type.Boolean(), Type.Null()]), changed_files: Type.Integer(), additions: Type.Integer(), deletions: Type.Integer() });
const Run = Type.Object({ id: Type.Integer(), name: Type.String(), status: Type.String(), conclusion: Type.Union([Type.String(), Type.Null()]), html_url: Type.String(),
  started_at: Type.Union([Type.String(), Type.Null()]), completed_at: Type.Union([Type.String(), Type.Null()]) });
const Runs = Type.Object({ total_count: Type.Integer(), check_runs: Type.Array(Run) });
const Status = Type.Object({ context: Type.String(), state: Type.String(), updated_at: Type.String(), target_url: Type.Union([Type.String(), Type.Null()]) });
const Statuses = Type.Object({ total_count: Type.Integer(), statuses: Type.Array(Status) });
const Comment = Type.Object({ ...Author, id: Type.Integer(), body: Type.String(), updated_at: Type.String(), html_url: Type.String(), path: Type.Optional(Type.String()), line: Type.Optional(Type.Union([Type.Integer(), Type.Null()])) });
const Review = Type.Object({ ...Author, id: Type.Integer(), state: Type.String(), body: Type.String(), submitted_at: Type.Union([Type.String(), Type.Null()]), html_url: Type.String() });
const PageInfo = Type.Object({ hasNextPage: Type.Boolean(), endCursor: Type.Union([Type.String(), Type.Null()]) });
const Thread = Type.Object({ isResolved: Type.Boolean(), comments: Type.Object({ nodes: Type.Array(Type.Object({ id: Type.String(), author: Type.Union([Type.Object({ login: Type.String() }), Type.Null()]), authorAssociation: Type.String(), body: Type.String(), path: Type.String(), line: Type.Union([Type.Integer(), Type.Null()]), updatedAt: Type.String(), url: Type.String() })) }) });
const RequiredContext = Type.Union([
  Type.Object({ __typename: Type.Literal("CheckRun"), name: Type.String(), isRequired: Type.Boolean() }),
  Type.Object({ __typename: Type.Literal("StatusContext"), context: Type.String(), isRequired: Type.Boolean() }),
]);
const Graph = Type.Object({ errors: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 0 })), data: Type.Object({ repository: Type.Object({ pullRequest: Type.Object({
  reviewThreads: Type.Object({ nodes: Type.Array(Thread), pageInfo: PageInfo }),
  commits: Type.Object({ nodes: Type.Array(Type.Object({ commit: Type.Object({ oid: Type.String(), statusCheckRollup: Type.Union([Type.Null(), Type.Object({ contexts: Type.Object({ nodes: Type.Array(RequiredContext), pageInfo: PageInfo }) })]) }) })) }),
}) }) }) });
const QUERY = `query($owner:String!,$name:String!,$number:Int!,$after:String) {
  repository(owner:$owner,name:$name) { pullRequest(number:$number) {
    reviewThreads(first:100,after:$after) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first:1) { nodes { id author { login } authorAssociation body path line updatedAt url } } } }
    commits(last:1) { nodes { commit { oid statusCheckRollup { contexts(first:100) { pageInfo { hasNextPage endCursor } nodes {
      __typename ... on CheckRun { name isRequired(pullRequestNumber:$number) } ... on StatusContext { context isRequired(pullRequestNumber:$number) }
    } } } } } }
  } }
}`;
const PASSING = new Set(["success", "neutral", "skipped"]);
const MAX_PAGES = 5;
const MAX_TEXT = 8000;
export interface GitHubPullSnapshot { pull: PullRequest; remarks: PullRemark[]; ownLogin?: string }

/** Structured reads share the agent's authenticated caller and its author-trust rule. */
export async function readGitHubPull(repo: SessionRepo, call: Caller, trust: Pick<GitHubAuthorTrust, "judge">, ownLogin: string | undefined, number: number, annotations: boolean): Promise<GitHubPullSnapshot> {
  const pull = await call.get(`/pulls/${String(number)}`, Pull, "Pull requests: read");
  const [runs, statuses, comments, reviewComments, reviews, graph] = await Promise.all([
    call.get(`/commits/${pull.head.sha}/check-runs?per_page=100&filter=latest`, Runs, "Checks: read"),
    call.get(`/commits/${pull.head.sha}/status?per_page=100`, Statuses, "Commit statuses: read"),
    pages(call, `/issues/${String(number)}/comments`, Comment),
    pages(call, `/pulls/${String(number)}/comments`, Comment),
    pages(call, `/pulls/${String(number)}/reviews`, Review),
    threads(call, repo.slug, number, pull.head.sha),
  ]);
  const authors = [pull, ...comments.items, ...reviewComments.items, ...reviews.items].map((item) => ({ login: item.user?.login, association: item.author_association }));
  authors.push(...graph.comments.map((item) => ({ login: item.author?.login, association: item.authorAssociation })));
  const allowed = repo.everyone ? () => true : await trust.judge(repo.slug, await call.token(), authors);
  const safe = (login: string | undefined, association: string, body: string) => allowed({ login, association }) ? body.slice(0, MAX_TEXT) : "(text hidden: outside contributor)";
  const checks: PullCheck[] = runs.check_runs.map((run): PullCheck => {
    const seconds = run.started_at === null || run.completed_at === null ? undefined : (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000;
    return { id: `run:${String(run.id)}`, name: run.name, state: run.status !== "completed" ? (run.status === "queued" ? "queued" : "running") : PASSING.has(run.conclusion ?? "") ? "passed" : run.conclusion === "cancelled" ? "cancelled" : "failed", url: run.html_url,
      required: graph.required.has(`run-name:${run.name}`), ...(run.completed_at === null ? {} : { updatedAt: run.completed_at }), ...(seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {}) };
  });
  checks.push(...statuses.statuses.map((status): PullCheck => ({ id: `status:${status.context}`, name: status.context, state: status.state === "success" ? "passed" : status.state === "pending" ? "running" : "failed", url: status.target_url ?? "", updatedAt: status.updated_at, required: graph.required.has(`status:${status.context}`) })));
  if (annotations) {
    // Check annotations are useful failure output, not a claim to have read Actions' raw job logs.
    for (const check of checks.filter((item) => item.id.startsWith("run:") && (item.state === "failed" || item.state === "cancelled")).slice(0, 5)) {
      const output = await call.get(`/check-runs/${check.id.slice(4)}/annotations?per_page=100`, Type.Array(Type.Object({ message: Type.String(), raw_details: Type.Union([Type.String(), Type.Null()]) })), "Checks: read");
      const log = output.map((item) => item.raw_details ?? item.message).join("\n").slice(-MAX_TEXT).split("\n").slice(-40).join("\n");
      if (log !== "") { check.logTail = log; check.logSource = "annotations"; }
    }
  }
  const remark = (comment: Static<typeof Comment>, domain: "issue" | "review"): PullRemark => ({ id: `${domain}-comment:${String(comment.id)}`, kind: "comment", author: comment.user?.login ?? "deleted-user", body: safe(comment.user?.login, comment.author_association, comment.body), updatedAt: comment.updated_at, url: comment.html_url,
    ...(comment.path === undefined ? {} : { path: comment.path }), ...(comment.line === undefined || comment.line === null ? {} : { line: comment.line }) });
  const latest = new Map<string, PullRequest["reviews"][number]>();
  for (const review of reviews.items) {
    const reviewer = review.user?.login ?? "deleted-user";
    if (review.state === "DISMISSED") latest.delete(reviewer);
    else if (["APPROVED", "CHANGES_REQUESTED"].includes(review.state) || !latest.has(reviewer)) {
      latest.set(reviewer, { reviewer, state: review.state === "APPROVED" ? "approved" : review.state === "CHANGES_REQUESTED" ? "changes_requested" : "commented", updatedAt: review.submitted_at ?? pull.updated_at });
    }
  }
  const observed = new Set(checks.map((check) => check.id.startsWith("run:") ? `run-name:${check.name}` : `status:${check.name}`));
  const complete = [...graph.required].every((context) => observed.has(context)) && runs.total_count <= runs.check_runs.length && statuses.total_count <= statuses.statuses.length && comments.complete && reviewComments.complete && reviews.complete && graph.complete;
  const mergeability = pull.mergeable === null ? "unknown" : pull.mergeable ? "clean" : "conflicting";
  const state = pull.merged ? "merged" : pull.state === "closed" ? "closed" : pull.draft ? "draft" : "open";
  const reason = state !== "open" ? "Only an open, non-draft PR can merge."
    : mergeability !== "clean" ? (mergeability === "unknown" ? "GitHub has not computed mergeability." : "The branch conflicts with its base.")
    : checks.length === 0 ? "No CI ran on this commit."
    : !complete ? "The PR read is incomplete; refresh or merge by hand."
    : checks.some((check) => check.state !== "passed") ? "Every check must pass on this head commit."
    : [...latest.values()].some((review) => review.state === "changes_requested") ? "A reviewer requested changes." : undefined;
  const structured: PullRequest = { repo: repo.slug, number: pull.number, title: safe(pull.user?.login, pull.author_association, pull.title), url: pull.html_url, state, head: pull.head.ref, headSha: pull.head.sha, base: pull.base.ref, author: pull.user?.login ?? "deleted-user", updatedAt: pull.updated_at,
    mergeability, files: pull.changed_files, additions: pull.additions, deletions: pull.deletions, checks, reviews: [...latest.values()], complete,
    comments: graph.comments.map((item) => ({ id: item.id, kind: "comment", author: item.author?.login ?? "deleted-user", body: safe(item.author?.login, item.authorAssociation, item.body), path: item.path, ...(item.line === null ? {} : { line: item.line }), updatedAt: item.updatedAt, url: item.url })),
    merge: reason === undefined ? { kind: "allowed" } : { kind: "blocked", reason } };
  const remarks = [...comments.items.map((item) => remark(item, "issue")), ...reviewComments.items.map((item) => remark(item, "review")), ...reviews.items.filter((item) => item.submitted_at !== null).map((item): PullRemark => ({ id: `review:${String(item.id)}`, kind: "review", author: item.user?.login ?? "deleted-user", body: safe(item.user?.login, item.author_association, `${item.state}\n${item.body}`), updatedAt: item.submitted_at ?? pull.updated_at, url: item.html_url }))];
  return { pull: structured, remarks, ...(ownLogin === undefined ? {} : { ownLogin }) };
}

async function pages<S extends TSchema>(call: Caller, path: string, schema: S): Promise<{ items: Static<S>[]; complete: boolean }> {
  const items: Static<S>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const next = await call.get(`${path}?per_page=100&page=${String(page)}`, Type.Array(schema), "Pull requests: read");
    items.push(...next);
    if (next.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

async function threads(call: Caller, repo: string, number: number, sha: string) {
  const [owner, name] = repo.split("/");
  const comments: Static<typeof Thread>["comments"]["nodes"] = [];
  const required = new Set<string>();
  let after: string | null = null;
  let complete = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result: Static<typeof Graph> = await call.graphql({ query: QUERY, variables: { owner, name, number, after } }, Graph);
    const pr = result.data.repository.pullRequest;
    for (const thread of pr.reviewThreads.nodes) if (!thread.isResolved) comments.push(...thread.comments.nodes);
    if (pr.commits.nodes[0]?.commit.oid !== sha) complete = false;
    const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
    if (contexts !== undefined) {
      if (contexts.pageInfo.hasNextPage) complete = false;
      for (const context of contexts.nodes) if (context.isRequired) required.add(context.__typename === "CheckRun" ? `run-name:${context.name}` : `status:${context.context}`);
    }
    if (!pr.reviewThreads.pageInfo.hasNextPage) return { comments, required, complete };
    after = pr.reviewThreads.pageInfo.endCursor;
    if (after === null) throw new Error("GitHub returned a missing review-thread cursor.");
  }
  return { comments, required, complete: false };
}
