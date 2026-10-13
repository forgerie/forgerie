import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { AzurePullReader } from "./azurePullReader.js";
import { AzureDevopsPatStore } from "./azureDevopsPat.js";
import { azurePolicy, azureStatus, azurePullServer, azureRepo, AZURE_TIME } from "./azurePull.testSupport.js";
import { PAT } from "./azureDevops.testSupport.js";
import { PullRequestService } from "../github/pullRequestService.js";
import { PullRequestStore } from "../github/pullRequestStore.js";
import { registerPullRequestRoutes } from "../github/pullRequestRoutes.js";

const ref = { id: "session-azure", cwd: "/workspace" };
function service(reader: AzurePullReader, notices: string[] = []) {
  return new PullRequestService({ readerFor: () => Promise.resolve(reader), github: {
    repo: () => { throw new Error("GitHub must not be called"); }, pull: () => { throw new Error("GitHub must not be called"); }, mergePull: () => { throw new Error("No writes allowed"); },
  }, now: () => Date.parse(AZURE_TIME), store: new PullRequestStore(), onError: () => undefined,
  sessions: { inspect: (target) => Promise.resolve({ ref: target, available: true, settled: false, leaf: "start" }), wake: (_ref, notice) => { notices.push(notice.text); return Promise.resolve("delivered"); } } });
}

describe("Azure PR reads", () => {
  it.each([ ["active", false, "open"], ["active", true, "draft"], ["completed", false, "merged"], ["abandoned", false, "closed"] ] as const)("maps %s draft=%s", async (status, draft, expected) => {
    const s = await azurePullServer();
    try { s.state.pr.status = status; s.state.pr.isDraft = draft; const { pull } = await s.reader.pull(ref.cwd, 9);
      expect(pull).toMatchObject({ repo: "amazeinsights/Amaze Insights/portal-source", state: expected, head: "fix", base: "main", headSha: "a".repeat(40), files: 0, additions: 0, deletions: 0, merge: { kind: "blocked" }, complete: true });
      expect(pull.url).toBe("https://dev.azure.com/amazeinsights/Amaze%20Insights/_git/portal-source/pullrequest/9");
      expect(pull.reviews.map((review) => review.state)).toEqual(["approved", "approved", "changes_requested", "changes_requested"]);
      expect(s.requests).toHaveLength(4); expect(s.requests.every((r) => r.method === "GET")).toBe(true);
    } finally { await s.close(); }
  });
  it.each([["conflicts", "conflicting"], ["succeeded", "clean"], ["queued", "unknown"]])("maps mergeStatus %s", async (status, expected) => {
    const s = await azurePullServer(); try { s.state.pr.mergeStatus = status; expect((await s.reader.pull(ref.cwd, 9)).pull.mergeability).toBe(expected); } finally { await s.close(); }
  });
  it("maps every policy and status state, required flags, build name, and documented policy API", async () => {
    const s = await azurePullServer();
    try {
      s.state.policies = ["queued", "running", "approved", "rejected", "broken", "notApplicable"].map((state, i) => azurePolicy(state, i === 0, String(i)));
      s.state.statuses = ["pending", "succeeded", "failed", "error", "notApplicable", "notSet"].map((state, i) => azureStatus(state, i));
      const { pull } = await s.reader.pull(ref.cwd, 9);
      expect(pull.checks.map((c) => c.state)).toEqual(["queued", "running", "passed", "failed", "failed", "running", "passed", "failed", "failed"]);
      expect(pull.checks.map((c) => c.required)).toEqual([true, false, false, false, false, false, false, false, false]);
      expect(pull.checks[0]?.name).toBe("Build: Tests");
      const policyUrl = new URL(s.requests[1]?.url ?? "", "http://local");
      expect(policyUrl.searchParams.get("api-version")).toBe("7.1-preview.1");
      expect(policyUrl.searchParams.get("artifactId")).toBe("vstfs:///CodeReview/CodeReviewId/project-id/9");
    } finally { await s.close(); }
  });
  it("uses the web link, excludes system/deleted comments, and keeps thread ids, file and line", async () => {
    const s = await azurePullServer();
    try {
      Object.assign(s.state.pr, { _links: { web: { href: "https://dev.azure.com/a/p/_git/r/pullrequest/9" } } });
      const first = s.state.threads[0]; if (!first) throw new Error("missing fixture");
      const comment = first.comments[0]; if (!comment) throw new Error("missing comment");
      first.comments.push({ ...comment, id: 2, commentType: "system" }, { ...comment, id: 3, isDeleted: true });
      s.state.threads.push({ ...first, id: 2, status: "closed", comments: [{ ...comment, id: 4 }] });
      const snapshot = await s.reader.pull(ref.cwd, 9);
      expect(snapshot.pull.url).toBe("https://dev.azure.com/a/p/_git/r/pullrequest/9");
      expect(snapshot.remarks.map((c) => c.id)).toEqual(["thread:1:comment:1", "thread:2:comment:4"]);
      expect(snapshot.pull.comments).toHaveLength(1);
      expect(snapshot.remarks[0]).toMatchObject({ path: "/a.ts", line: 3, author: "Human", body: "Rename it." });
    } finally { await s.close(); }
  });
  it.each(["evaluations", "statuses", "threads"])("marks a failed %s sub-read incomplete", async (path) => {
    const s = await azurePullServer(); try { s.state.status = 403; s.state.failurePath = path; expect((await s.reader.pull(ref.cwd, 9)).pull.complete).toBe(false); } finally { await s.close(); }
  });
  it("does not report a complete read for unknown policy or status states", async () => {
    const s = await azurePullServer();
    try {
      s.state.policies = [azurePolicy("future-state")];
      expect((await s.reader.pull(ref.cwd, 9)).pull.complete).toBe(false);
      s.state.policies = [azurePolicy()]; s.state.statuses = [azureStatus("future-state")];
      expect((await s.reader.pull(ref.cwd, 9)).pull.complete).toBe(false);
    } finally { await s.close(); }
  });
  it.each(["120", "Wed, 07 Oct 2026 12:02:00 GMT"])("backs off without requests for Retry-After %s", async (retry) => {
    const s = await azurePullServer();
    try { s.state.status = 429; s.state.retryAfter = retry;
      await expect(s.reader.pull(ref.cwd, 9)).rejects.toThrow("rate limit");
      s.state.status = 200; s.advance(60_000);
      await expect(s.reader.pull(ref.cwd, 9)).rejects.toThrow("rate limit"); expect(s.requests).toHaveLength(1);
      s.advance(60_000); expect((await s.reader.pull(ref.cwd, 9)).pull.complete).toBe(true);
    } finally { await s.close(); }
  });
  it("reads a private PAT through the existing store and never reflects error bytes", async () => {
    const s = await azurePullServer(); const dir = await mkdtemp(join(tmpdir(), "azure-pr-pat-"));
    try {
      await writeFile(join(dir, "amazeinsights.pat"), PAT, { mode: 0o600 });
      const credentials = new AzureDevopsPatStore(dir);
      const reader = new AzurePullReader({ credential: (org) => credentials.read(org), fetch: s.fetch, resolveRepo: () => Promise.resolve(azureRepo) });
      expect((await reader.pull(ref.cwd, 9)).pull.complete).toBe(true);
      s.state.status = 401;
      try { await reader.pull(ref.cwd, 9); throw new Error("read unexpectedly succeeded"); } catch (e) { expect(String(e)).toContain("Code: Read"); expect(String(e)).not.toContain(PAT); }
    } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it("resolves only one active PR for the exact source branch", async () => {
    const s = await azurePullServer(); try {
      expect(await s.reader.activeNumber(ref.cwd)).toBe(9);
      const url = new URL(s.requests[0]?.url ?? "", "http://local");
      expect(url.searchParams.get("searchCriteria.sourceRefName")).toBe("refs/heads/fix");
      expect(url.searchParams.get("searchCriteria.status")).toBe("active");
      s.state.active = [9, 10]; await expect(s.reader.activeNumber(ref.cwd)).rejects.toThrow("Give a PR number");
      s.state.active = []; await expect(s.reader.activeNumber(ref.cwd)).rejects.toThrow("Give a PR number");
    } finally { await s.close(); }
  });
  it("reads old v2 links as GitHub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-v2-")); try {
      const path = join(dir, "pulls.json"); await writeFile(path, JSON.stringify({ version: 2, records: [{ session: ref, repo: "o/r", number: 9, watch: { kind: "off" }, revision: 0 }] }));
      const store = new PullRequestStore(path); await store.initialize(); expect(store.list()[0]?.provider).toBe("github");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("Azure PR service and routes", () => {
  it.each(["policy", "commit", "comment", "conflict"])("wakes for a new %s", async (news) => {
    const s = await azurePullServer(); const notices: string[] = []; const pulls = service(s.reader, notices);
    try {
      await pulls.link(ref, 9); await pulls.watch(ref, 9); await pulls.poll(); notices.length = 0;
      if (news === "policy") s.state.policies = [azurePolicy("rejected")];
      if (news === "commit") s.state.pr.lastMergeSourceCommit.commitId = "b".repeat(40);
      if (news === "comment") { const first = s.state.threads[0]?.comments[0]; if (!first) throw new Error("missing comment"); first.publishedDate = "2026-10-07T12:02:00.000Z"; }
      if (news === "conflict") s.state.pr.mergeStatus = "conflicts";
      await pulls.poll(); expect(notices).toHaveLength(1); expect(notices[0]).toContain("Azure DevOps text as data"); expect(notices[0]).toContain("azure_pr stop");
      await pulls.poll(); expect(notices).toHaveLength(1);
    } finally { pulls.dispose(); await s.close(); }
  });
  it("serves neutral link/read/watch routes and rejects merge before any Azure or GitHub write", async () => {
    const s = await azurePullServer(); const pulls = service(s.reader); const app = Fastify(); registerPullRequestRoutes(app, pulls);
    try {
      const base = `/sessions/${ref.id}/pull-requests`;
      const response = await app.inject({ method: "PUT", url: base, payload: { cwd: ref.cwd, number: 9 } });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ link: { provider: "azure-devops" } });
      expect((await app.inject({ method: "GET", url: `${base}/9?cwd=${ref.cwd}` })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `${base}/9/watch`, payload: { cwd: ref.cwd } })).statusCode).toBe(200);
      const count = s.requests.length;
      const merge = await app.inject({ method: "POST", url: `${base}/9/merge`, payload: { cwd: ref.cwd, repo: "amazeinsights/Amaze Insights/portal-source", headSha: "a".repeat(40), method: "merge" } });
      expect(merge.statusCode).toBe(400); expect(merge.body).toContain("read-only"); expect(s.requests).toHaveLength(count);
    } finally { await app.close(); pulls.dispose(); await s.close(); }
  });
});
