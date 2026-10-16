import { describe, expect, it } from "vitest";
import { GitHubAgent } from "./githubAgent.js";
import { FakeGitHub, actionJob, json, serveActionRun, workflowRun } from "./fakeGitHub.testSupport.js";
import type { GitHubAuthor } from "./githubTrust.js";

const base = "https://api.github.com/repos/owner/repo";
function fixture(everyone = true) {
  const github = new FakeGitHub();
  const judged: GitHubAuthor[][] = [];
  const agent = new GitHubAgent({ fetch: github.fetch,
    app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken() { /* Test tokens do not expire. */ }, status: () => ({ state: "configured", app: { slug: "forgerie", owner: "owner", url: "https://github.com/apps/forgerie" }, installUrl: "" }) },
    trust: { judge: (_repo, _token, authors) => { judged.push([...authors]); return Promise.resolve(author => author.association === "OWNER"); } },
    resolveRepo: () => Promise.resolve({ slug: "owner/repo", everyone }),
  });
  return { github, agent, judged };
}
describe("GitHub Actions reads and dispatch", () => {
  it("reads attempt-pinned jobs, durations, skipped jobs and bounded failure annotations", async () => {
    const f = fixture(); serveActionRun(f.github, "owner/repo", { run_number: 42 }, [actionJob(), actionJob({ id: 11, conclusion: "skipped" })]);
    f.github.always(`GET ${base}/check-runs/20/annotations`, json([{ message: "failure", raw_details: "line\n".repeat(100) }]));
    const run = await f.agent.run("/workspace", 4812);
    expect(run).toMatchObject({ runId: 4812, runNumber: 42, attempt: 1, status: "running", complete: true, jobs: [{ id: 10, state: "failed", seconds: 5, logSource: "annotations" }, { id: 11, state: "skipped" }] });
    expect(run.jobs[0]?.logTail?.split("\n").length).toBeLessThanOrEqual(40);
    expect(await f.agent.read("/workspace", { action: "run", runId: 4812 })).toContain('"logSource": "annotations"');
  });
  it("lists recent runs with filters and no jobs, through github_read runs", async () => {
    const f = fixture(); serveActionRun(f.github, "owner/repo");
    f.github.always(`GET ${base}/actions/workflows/ci.yml/runs`, json({ total_count: 1, workflow_runs: [workflowRun()] }));
    const text = await f.agent.read("/workspace", { action: "runs", headSha: "a".repeat(40), branch: "main", workflow: "ci.yml", limit: 7 });
    expect(text).toContain('"jobs": []');
    expect(text).toContain('"runNumber": 42');
    const request = f.github.requests[0]; expect(request?.url).toContain("head_sha="); expect(request?.url).toContain("branch=main"); expect(request?.url).toContain("per_page=7");
  });
  it("requires a positive integer run number in GitHub reads", async () => {
    const f = fixture();
    for (const runNumber of [undefined, 0, -1, 1.5]) {
      serveActionRun(f.github, "owner/repo", { run_number: runNumber });
      await expect(f.agent.run("/workspace", 4812)).rejects.toThrow("unexpected answer");
    }
  });
  it("does not trust the actor for an outside contributor's run title", async () => {
    const f = fixture(false); serveActionRun(f.github, "owner/repo", { display_title: "external instruction", pull_requests: [{ number: 9 }] });
    f.github.always(`GET ${base}/pulls/9`, json({ user: { login: "outside" }, author_association: "CONTRIBUTOR" }));
    f.github.always(`GET ${base}/commits/${"a".repeat(40)}`, json({ author: { login: "outside" } }));
    expect((await f.agent.run("/workspace", 4812)).title).toBe("(text hidden: outside contributor)");
    expect(f.judged).toEqual([[{ login: "outside", association: "CONTRIBUTOR" }, { login: "outside", association: "NONE" }]]);
    expect(JSON.stringify(await f.agent.runs("/workspace"))).not.toContain("external instruction");
  });
  it("checks commit authors, not dispatchers, for push run titles", async () => {
    const f = fixture(false); serveActionRun(f.github, "owner/repo");
    f.github.always(`GET ${base}/commits/${"a".repeat(40)}`, json({ author: { login: "outside" } }));
    expect((await f.agent.run("/workspace", 4812)).title).toContain("hidden");
    expect(f.judged).toEqual([[{ login: "outside", association: "NONE" }]]);
  });
  it("keeps an incomplete jobs read incomplete and reports missing Actions permission with the existing app link", async () => {
    const f = fixture(); serveActionRun(f.github, "owner/repo");
    f.github.always(`GET ${base}/actions/runs/4812/attempts/1/jobs`, json({ total_count: 2, jobs: [actionJob()] }));
    f.github.always(`GET ${base}/check-runs/20/annotations`, json([]));
    expect((await f.agent.run("/workspace", 4812)).complete).toBe(false);
    f.github.always(`GET ${base}/actions/runs/4812`, json({ message: "Resource not accessible by integration" }, { status: 403 }));
    await expect(f.agent.run("/workspace", 4812)).rejects.toThrow('needs "Actions: read"');
    await expect(f.agent.run("/workspace", 4812)).rejects.toThrow("https://github.com/settings/apps/forgerie/permissions");
  });
  it("paginates jobs and derived head-SHA runs, and refuses incomplete derived lists", async () => {
    const f = fixture(); serveActionRun(f.github, "owner/repo");
    const jobs = Array.from({ length: 100 }, (_value, index) => actionJob({ id: index + 1, conclusion: "success" }));
    f.github.on(`GET ${base}/actions/runs/4812/attempts/1/jobs`, json({ total_count: 101, jobs }), json({ total_count: 101, jobs: [actionJob({ id: 101, conclusion: "success" })] }));
    expect((await f.agent.run("/workspace", 4812)).jobs).toHaveLength(101);
    const runs = Array.from({ length: 100 }, (_value, index) => workflowRun({ id: index + 1 }));
    f.github.on(`GET ${base}/actions/runs`, json({ total_count: 101, workflow_runs: runs }), json({ total_count: 101, workflow_runs: [workflowRun({ id: 101 })] }));
    const derived = await f.agent.runsForHead("/workspace", "a".repeat(40));
    expect(derived).toHaveLength(101);
    expect(derived[0]).toMatchObject({ runId: 1, runNumber: 42 });
    expect(f.github.requests.at(-1)?.url).toContain("page=2");
    f.github.always(`GET ${base}/actions/runs`, json({ total_count: 2, workflow_runs: [workflowRun()] }));
    await expect(f.agent.runsForHead("/workspace", "a".repeat(40))).rejects.toThrow("incomplete");
  });
  it("caps annotation calls even when the output is empty, and refuses malformed dispatch success", async () => {
    const f = fixture(); serveActionRun(f.github, "owner/repo", {}, Array.from({ length: 8 }, (_value, index) => actionJob({ id: index + 1 })));
    f.github.always(`GET ${base}/check-runs/20/annotations`, json([]));
    await f.agent.run("/workspace", 4812);
    expect(f.github.count(`GET ${base}/check-runs/20/annotations`)).toBe(5);
    f.github.on(`POST ${base}/actions/workflows/ci.yml/dispatches`, json({}));
    await expect(f.agent.dispatch("/workspace", "ci.yml", "main")).rejects.toThrow("unexpected answer");
  });
  it("requests return_run_details and never guesses a run after a 204", async () => {
    const f = fixture();
    f.github.on(`POST ${base}/actions/workflows/ci.yml/dispatches`, json({ workflow_run_id: 4812, run_url: `${base}/actions/runs/4812`, html_url: workflowRun().html_url }), new Response(null, { status: 204 }));
    expect(await f.agent.dispatch("/workspace", "ci.yml", "main", { target: "linux" })).toEqual({ repo: "owner/repo", runId: 4812, url: workflowRun().html_url });
    expect(JSON.parse(f.github.requests[0]?.body ?? "null")).toEqual({ ref: "main", inputs: { target: "linux" }, return_run_details: true });
    expect(await f.agent.dispatch("/workspace", "ci.yml", "main")).toEqual({ repo: "owner/repo" });
    expect(f.github.requests.every(request => request.method === "POST")).toBe(true);
  });
});
