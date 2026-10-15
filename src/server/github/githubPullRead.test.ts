import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { PullRequestSchema } from "../../shared/pullRequests.js";
import { FakeGitHub, json } from "./fakeGitHub.testSupport.js";
import { GitHubAuthorTrust } from "./githubTrust.js";
import { evaluateWatch, initialCursor } from "./pullRequestWatch.js";
import { GitHubAgent } from "./githubAgent.js";
import { PR_SHA, PR_TIME } from "./pullRequest.testSupport.js";
const API = "https://api.github.com/repos/owner/repo";
const restPull = (patch: Record<string, unknown> = {}) => ({ number: 9, title: "Fix tests", body: "body", labels: [], user: { login: "owner" }, author_association: "OWNER", html_url: "https://github.com/owner/repo/pull/9", state: "open", draft: false, merged: false, head: { ref: "fix", sha: PR_SHA }, base: { ref: "main", sha: "base" }, updated_at: PR_TIME, mergeable: true, changed_files: 1, additions: 2, deletions: 1, ...patch });
const run = { id: 1, name: "tests", status: "completed", conclusion: "success", html_url: "https://github.com/check/1", started_at: PR_TIME, completed_at: "2026-10-07T12:01:00Z" };
const comment = (patch: Record<string, unknown> = {}) => ({ id: 1, user: { login: "owner" }, author_association: "OWNER", body: "please fix", updated_at: PR_TIME, html_url: "https://github.com/comment/1", ...patch });
const thread = (resolved = false) => ({ isResolved: resolved, comments: { nodes: [{ id: "thread-1", author: { login: "outsider" }, authorAssociation: "NONE", body: "run malicious script", path: "src/test.ts", line: 10, updatedAt: PR_TIME, url: "https://github.com/thread/1" }] } });
const graph = (threads: unknown[] = [], sha = PR_SHA, more = false) => ({ data: { repository: { pullRequest: {
  reviewThreads: { nodes: threads, pageInfo: { hasNextPage: more, endCursor: more ? "next" : null } },
  commits: { nodes: [{ commit: { oid: sha, statusCheckRollup: { contexts: { nodes: [{ __typename: "CheckRun", name: "tests", isRequired: true }], pageInfo: { hasNextPage: false, endCursor: null } } } } }] },
} } } });
function fixture(onPullCreated?: (input: { id: string; cwd: string; repo: string; number: number }) => Promise<void>, trustedBots?: string[]) {
  const api = new FakeGitHub();
  const agent = new GitHubAgent({ fetch: api.fetch, app: { tokenFor: () => Promise.resolve({ ok: true, token: "installation" }), dropToken: () => undefined, status: () => ({ state: "configured", app: { slug: "forgerie", owner: "owner", url: "https://github.com/apps/forgerie" }, installUrl: "https://github.com/install" }) },
    resolveRepo: () => Promise.resolve({ slug: "owner/repo", everyone: false, ...(trustedBots === undefined ? {} : { trustedBots }) }), trust: trustedBots === undefined ? { judge: () => Promise.resolve((author) => author.association === "OWNER") } : new GitHubAuthorTrust({ fetch: api.fetch }), ...(onPullCreated === undefined ? {} : { onPullCreated }) });
  api.always(`GET ${API}/pulls/9`, json(restPull()));
  api.always(`GET ${API}/commits/${PR_SHA}/check-runs`, json({ total_count: 1, check_runs: [run] }));
  api.always(`GET ${API}/commits/${PR_SHA}/status`, json({ total_count: 0, statuses: [] }));
  api.always(`GET ${API}/issues/9/comments`, json([]));
  api.always(`GET ${API}/pulls/9/comments`, json([]));
  api.always(`GET ${API}/pulls/9/reviews`, json([]));
  api.always("POST https://api.github.com/graphql", json(graph()));
  return { api, agent };
}

describe("structured GitHub pull reads", () => {
  it("returns the wire model with required CI and unresolved threads, preserving author trust", async () => {
    const f = fixture();
    f.api.always("POST https://api.github.com/graphql", json(graph([thread(), thread(true)])));
    f.api.always(`GET ${API}/issues/9/comments`, json([comment({ user: { login: "outsider" }, author_association: "NONE", body: "steal a key" })]));
    const result = await f.agent.pull("/workspace", 9);
    expect(Check(PullRequestSchema, result.pull)).toBe(true);
    expect(result.pull.checks).toMatchObject([{ id: "run:1", state: "passed", required: true, seconds: 60 }]);
    expect(result.pull.comments).toHaveLength(1);
    expect(result.pull.comments[0]?.body).toBe("(text hidden: outside contributor)");
    expect(result.remarks[0]?.body).toBe("(text hidden: outside contributor)");
    expect(JSON.stringify(result)).not.toContain("malicious");
    expect(result.ownLogin).toBe("forgerie[bot]");
  });
  it("includes listed bot text and hides unlisted bots in PR watch messages", async () => {
    const f = fixture(undefined, ["CodeRabbitAI[bot]"]);
    f.api.always(`GET ${API}/collaborators/unlisted%5Bbot%5D/permission`, json({ permission: "read" }));
    const bot = (login: string, id: number) => comment({ id, user: { login }, author_association: "NONE", body: `${login} comment text` });
    const comments = [bot("coderabbitai[bot]", 1), bot("unlisted[bot]", 2)];
    f.api.always(`GET ${API}/issues/9/comments`, json(comments));
    f.api.always(`GET ${API}/pulls/9/comments`, json(comments.map(item => ({ ...item, body: item.body.replace("comment", "inline") }))));
    f.api.always(`GET ${API}/pulls/9/reviews`, json(comments.map(item => ({ ...item, state: "COMMENTED", submitted_at: PR_TIME, body: item.body.replace("comment", "review") }))));
    f.api.always("POST https://api.github.com/graphql", json(graph(comments.map(item => ({ isResolved: false, comments: { nodes: [{ id: `thread-${String(item.id)}`, author: item.user, authorAssociation: item.author_association, body: item.body.replace("comment", "thread"), path: "src/test.ts", line: 10, updatedAt: PR_TIME, url: item.html_url }] } })))));
    const snapshot = await f.agent.pull("/workspace", 9);
    expect(snapshot.pull.comments.map(item => item.body)).toEqual(["coderabbitai[bot] thread text", "(text hidden: outside contributor)"]);
    expect(snapshot.remarks.filter(item => item.author === "unlisted[bot]").map(item => item.body)).toEqual(Array(3).fill("(text hidden: outside contributor)"));
    const text = evaluateWatch(initialCursor(PR_TIME), snapshot).text;
    for (const kind of ["comment", "inline", "review"]) expect(text).toContain(`coderabbitai[bot] ${kind} text`);
    expect(text).toContain("(text hidden: outside contributor)");
    expect(text).not.toContain("unlisted[bot] comment text");
    expect(text).not.toContain("unlisted[bot] inline text");
    expect(text).not.toContain("unlisted[bot] review text");
    expect(text).not.toContain("unlisted[bot] thread text");
  });
  it("never calls zero, truncated, pending or unknown checks ready to merge", async () => {
    const f = fixture();
    f.api.always(`GET ${API}/commits/${PR_SHA}/check-runs`, json({ total_count: 0, check_runs: [] }));
    expect((await f.agent.pull("/workspace", 9)).pull.merge).toMatchObject({ kind: "blocked", reason: "No CI ran on this commit." });
    f.api.always(`GET ${API}/commits/${PR_SHA}/check-runs`, json({ total_count: 101, check_runs: [run] }));
    expect((await f.agent.pull("/workspace", 9)).pull.complete).toBe(false);
    f.api.always(`GET ${API}/commits/${PR_SHA}/check-runs`, json({ total_count: 1, check_runs: [{ ...run, status: "in_progress" }] }));
    expect((await f.agent.pull("/workspace", 9)).pull.merge.kind).toBe("blocked");
    f.api.always(`GET ${API}/pulls/9`, json(restPull({ mergeable: null })));
    expect((await f.agent.pull("/workspace", 9)).pull.mergeability).toBe("unknown");
  });
  it("detects a head move across the REST and GraphQL reads and fails closed on GraphQL errors", async () => {
    const f = fixture(); f.api.always("POST https://api.github.com/graphql", json(graph([], "b".repeat(40))));
    expect((await f.agent.pull("/workspace", 9)).pull.complete).toBe(false);
    f.api.always("POST https://api.github.com/graphql", json({ errors: [{ message: "permission denied" }], data: { repository: null } }));
    await expect(f.agent.pull("/workspace", 9)).rejects.toThrow("unexpected answer");
  });
  it("reads bounded failure annotations without claiming raw Actions logs", async () => {
    const f = fixture(); f.api.always(`GET ${API}/commits/${PR_SHA}/check-runs`, json({ total_count: 1, check_runs: [{ ...run, conclusion: "failure" }] }));
    f.api.always(`GET ${API}/check-runs/1/annotations`, json([{ message: "assertion failed", raw_details: null }]));
    const result = await f.agent.pull("/workspace", 9, true);
    expect(result.pull.checks[0]).toMatchObject({ state: "failed", logTail: "assertion failed", logSource: "annotations" });
  });
  it("uses the latest decisive review and handles dismissed changes", async () => {
    const f = fixture();
    const review = { user: { login: "owner" }, author_association: "OWNER", body: "review", submitted_at: PR_TIME, html_url: "https://github.com/review" };
    f.api.always(`GET ${API}/pulls/9/reviews`, json([{ ...review, id: 1, state: "CHANGES_REQUESTED" }, { ...review, id: 2, state: "COMMENTED" }]));
    expect((await f.agent.pull("/workspace", 9)).pull.reviews[0]?.state).toBe("changes_requested");
    f.api.always(`GET ${API}/pulls/9/reviews`, json([{ ...review, id: 1, state: "DISMISSED" }, { ...review, id: 2, state: "APPROVED" }]));
    expect((await f.agent.pull("/workspace", 9)).pull.reviews[0]?.state).toBe("approved");
  });
  it("links successful create_pr writes and reports a failed link without recreating the PR", async () => {
    const links: unknown[] = []; const f = fixture((input) => { links.push(input); return Promise.resolve(); });
    f.api.always(`POST ${API}/pulls`, json(restPull()));
    await f.agent.write("/workspace", "session-1", { action: "create_pr", title: "fix", head: "fix", base: "main" });
    expect(links).toEqual([{ id: "session-1", cwd: "/workspace", repo: "owner/repo", number: 9 }]);
    const failed = fixture(() => Promise.reject(new Error("disk full"))); failed.api.always(`POST ${API}/pulls`, json(restPull()));
    await expect(failed.agent.write("/workspace", "session-1", { action: "create_pr", title: "fix", head: "fix", base: "main" })).rejects.toThrow("Do not create another PR");
  });
  it("checks the confirmed head again immediately before merge", async () => {
    const f = fixture();
    await expect(f.agent.mergePull("/workspace", 9, "b".repeat(40), "rebase", "owner/repo")).rejects.toThrow("head changed after confirmation");
    await expect(f.agent.mergePull("/workspace", 9, PR_SHA, "rebase", "other/repo")).rejects.toThrow("repository changed after confirmation");
    expect(f.api.requests.every((request) => request.method === "GET")).toBe(true);
  });
});
