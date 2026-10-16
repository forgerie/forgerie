import { describe, expect, it } from "vitest";
import { createPullRequestApi, parsePullEvent, type PullLink, type PullRequest } from "./pullRequestApi";

const SHA = "a".repeat(40);
const TIME = "2026-10-07T12:00:00.000Z";
// The server's own fixture shape (src/server/github/pullRequest.testSupport.ts on main), field for field.
const pull: PullRequest = { repo: "owner/repo", number: 9, title: "Fix tests", url: "https://github.com/owner/repo/pull/9", state: "open", head: "fix", headSha: SHA, base: "main",
  author: "owner", updatedAt: TIME, mergeability: "clean", files: 1, additions: 2, deletions: 1,
  checks: [{ id: "run:1", name: "tests", state: "failed", url: "https://github.com/check/1", required: true, updatedAt: TIME, seconds: 12.5, logTail: "boom", logSource: "annotations" }],
  reviews: [{ reviewer: "jordan", state: "approved", updatedAt: TIME }],
  comments: [{ id: "c1", kind: "comment", author: "jordan", body: "Rename it.", updatedAt: TIME, url: "https://github.com/c/1", path: "a.ts", line: 3 }],
  complete: true, merge: { kind: "blocked", reason: "Every check must pass on this head commit." } };
const link: PullLink = { provider: "github", session: { id: "s1", cwd: "/repo" }, repo: "owner/repo", number: 9, watch: { kind: "watching", since: TIME, wakes: 1, lastWake: TIME } };

function fake(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request = async (path: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ path, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ kind: "pull_request_error", error: "Unexpected" }), { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  };
  return { calls, api: createPullRequestApi(request) };
}

describe("pull request API", () => {
  const ref = { id: "s1", cwd: "/repo" };

  it("lists every linked pull request, keeping one whose read failed", async () => {
    const second: PullLink = { ...link, number: 10, watch: { kind: "off" } };
    const { calls, api } = fake({ "GET /api/sessions/s1/pull-requests?cwd=%2Frepo": { body: { items: [{ link, pull }, { link: second, pull: null, error: "GitHub refused." }] } } });
    await expect(api.list(ref)).resolves.toEqual([{ link, pull }, { link: second, pull: null, error: "GitHub refused." }]);
    expect(calls).toEqual([{ path: "/api/sessions/s1/pull-requests?cwd=%2Frepo", method: "GET", body: undefined }]);
  });

  it("discovers open PRs and previews an unlinked PR using GET only", async () => {
    const open = { provider: "github", repo: pull.repo, items: [{ ...pull, state: "open" }], complete: false };
    const preview = { provider: "github", pull };
    const { calls, api } = fake({
      "GET /api/sessions/s1/pull-requests/open?cwd=%2Frepo": { body: open },
      "GET /api/sessions/s1/pull-requests/9/preview?cwd=%2Frepo": { body: preview },
    });
    await expect(api.open(ref)).resolves.toEqual(open);
    await expect(api.preview(ref, 9)).resolves.toEqual(preview);
    expect(calls.every(call => call.method === "GET" && call.body === undefined)).toBe(true);
  });

  it("reads one pull request by number", async () => {
    const { api } = fake({ "GET /api/sessions/s1/pull-requests/9?cwd=%2Frepo": { body: { link, pull } } });
    await expect(api.read(ref, 9)).resolves.toEqual({ link, pull });
  });

  it("links, unlinks, watches, and stops one pull request with the documented bodies", async () => {
    const { calls, api } = fake({
      "PUT /api/sessions/s1/pull-requests": { body: { link, pull } },
      "POST /api/sessions/s1/pull-requests/9/watch": { body: link },
      "DELETE /api/sessions/s1/pull-requests/9/watch?cwd=%2Frepo": { body: { ...link, watch: { kind: "stopped", reason: "Stopped.", at: TIME } } },
      "DELETE /api/sessions/s1/pull-requests/9?cwd=%2Frepo": { body: link },
    });
    await api.link(ref, 9);
    await api.watch(ref, 9);
    await expect(api.stopWatch(ref, 9)).resolves.toMatchObject({ watch: { kind: "stopped" } });
    await expect(api.unlink(ref, 9)).resolves.toEqual(link);
    expect(calls.map(({ method, path, body }) => ({ method, path: path.split("?")[0], body }))).toEqual([
      { method: "PUT", path: "/api/sessions/s1/pull-requests", body: { cwd: "/repo", number: 9 } },
      { method: "POST", path: "/api/sessions/s1/pull-requests/9/watch", body: { cwd: "/repo" } },
      { method: "DELETE", path: "/api/sessions/s1/pull-requests/9/watch", body: undefined },
      { method: "DELETE", path: "/api/sessions/s1/pull-requests/9", body: undefined },
    ]);
  });

  it("sends preview repository confirmation when linking without changing the legacy link body", async () => {
    const { calls, api } = fake({ "PUT /api/sessions/s1/pull-requests": { body: { link, pull } } });
    await api.link(ref, 9, { provider: "github", repo: pull.repo });
    expect(calls[0]?.body).toEqual({ cwd: ref.cwd, number: 9, expected: { provider: "github", repo: pull.repo } });
  });

  it("binds a merge to the repository, number, and head SHA the reader saw", async () => {
    const { calls, api } = fake({ "POST /api/sessions/s1/pull-requests/9/merge": { body: { text: "Merged #9.", url: pull.url } } });
    await expect(api.merge(ref, pull, "rebase")).resolves.toEqual({ text: "Merged #9.", url: pull.url });
    expect(calls[0]?.body).toEqual({ cwd: "/repo", repo: "owner/repo", headSha: SHA, method: "rebase" });
  });

  it("surfaces the server's refusal in its own words", async () => {
    const { api } = fake({ "POST /api/sessions/s1/pull-requests/9/merge": { status: 400, body: { kind: "pull_request_error", error: "The PR head changed after confirmation; read it again." } } });
    await expect(api.merge(ref, pull, "rebase")).rejects.toThrow("The PR head changed after confirmation; read it again.");
  });

  it("refuses a response that breaks the contract instead of drawing a guess", async () => {
    const { api } = fake({ "GET /api/sessions/s1/pull-requests/9?cwd=%2Frepo": { body: { link, pull: { ...pull, merge: undefined } } } });
    await expect(api.read(ref, 9)).rejects.toThrow();
  });
});

describe("pull request events", () => {
  it("reads link and unlink events and ignores every other type", () => {
    expect(parsePullEvent({ type: "session.pull-request", link })).toEqual({ link, removed: false });
    expect(parsePullEvent({ type: "session.pull-request.unlinked", link })).toEqual({ link, removed: true });
    expect(parsePullEvent({ type: "status.update" })).toBeUndefined();
    expect(parsePullEvent(null)).toBeUndefined();
  });
});
