import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import type { PullCheck, PullRemark, PullRequest } from "../../shared/pullRequests.js";
import type { PullRequestReader, PullSnapshot } from "../github/pullRequestReader.js";
import type { AzureCredential } from "./azureDevopsPat.js";
import { azureRepoKey, azureSourceBranch, originAzureRepo, type AzureRepo } from "./azureRemote.js";

const text = Type.String();
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" });
const identity = Type.Object({ displayName: text, uniqueName: Type.Optional(text), id: Type.Optional(text) });
const web = Type.Optional(Type.Object({ web: Type.Optional(Type.Object({ href: text })) }));
const prSchema = Type.Object({ pullRequestId: Type.Integer({ minimum: 1 }), title: text, status: Type.Union([Type.Literal("active"), Type.Literal("completed"), Type.Literal("abandoned")]), isDraft: Type.Optional(Type.Boolean()), mergeStatus: text,
  sourceRefName: text, targetRefName: text, lastMergeSourceCommit: Type.Object({ commitId: text }), createdBy: identity, creationDate: date, closedDate: Type.Optional(date),
  repository: Type.Object({ name: text, project: Type.Object({ id: text, name: text }) }), reviewers: Type.Array(Type.Object({ ...identity.properties, vote: Type.Integer() })), _links: web });
const policySchema = Type.Object({ evaluationId: text, status: Type.Union(["queued", "running", "approved", "rejected", "broken", "notApplicable"].map((state) => Type.Literal(state))), configuration: Type.Object({ isBlocking: Type.Boolean(), type: Type.Object({ displayName: text }), settings: Type.Object({ buildDefinitionName: Type.Optional(text) }) }), completedDate: Type.Optional(date), _links: web });
const statusSchema = Type.Object({ id: Type.Integer(), state: Type.Union(["pending", "succeeded", "failed", "error", "notApplicable", "notSet"].map((state) => Type.Literal(state))), context: Type.Object({ name: text, genre: Type.Optional(text) }), description: Type.Optional(text), targetUrl: Type.Optional(text), creationDate: Type.Optional(date), updatedDate: Type.Optional(date) });
const threadSchema = Type.Object({ id: Type.Integer(), isDeleted: Type.Optional(Type.Boolean()), status: Type.Optional(Type.Union([text, Type.Integer()])), threadContext: Type.Optional(Type.Union([Type.Null(), Type.Object({ filePath: Type.Optional(text), rightFileStart: Type.Optional(Type.Object({ line: Type.Integer() })), leftFileStart: Type.Optional(Type.Object({ line: Type.Integer() })) })])),
  comments: Type.Array(Type.Object({ id: Type.Integer(), commentType: text, isDeleted: Type.Optional(Type.Boolean()), author: identity, content: Type.Optional(text), publishedDate: date, lastUpdatedDate: Type.Optional(date) })) });
const list = <T extends TSchema>(schema: T) => Type.Object({ value: Type.Array(schema, { maxItems: 2000 }) });
const policyStates: Record<string, PullCheck["state"] | undefined> = { queued: "queued", running: "running", approved: "passed", rejected: "failed", broken: "failed" };
const statusStates: Record<string, PullCheck["state"] | undefined> = { pending: "running", succeeded: "passed", failed: "failed", error: "failed" };
class AzurePullError extends Error {}
interface Dependencies {
  credential: (organization: string) => Promise<AzureCredential>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  resolveRepo?: (cwd: string) => Promise<AzureRepo | undefined>;
  branch?: (cwd: string) => Promise<string>;
}

/** GET-only adapter. Error bodies and network exceptions never leave this boundary. */
export class AzurePullReader implements PullRequestReader {
  readonly provider = "azure-devops";
  private readonly limitedUntil = new Map<string, number>();
  private readonly now: () => number;
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }
  async repo(cwd: string): Promise<{ slug: string }> { return { slug: azureRepoKey(await this.resolve(cwd)) }; }
  async activeNumber(cwd: string): Promise<number> {
    const repo = await this.resolve(cwd);
    const branch = await (this.deps.branch ?? azureSourceBranch)(cwd);
    const query = new URLSearchParams({ "searchCriteria.status": "active", "searchCriteria.sourceRefName": `refs/heads/${branch}`, "api-version": "7.1" });
    const result = await this.read(repo, `${this.gitBase(repo)}/pullrequests?${query}`, list(Type.Object({ pullRequestId: Type.Integer({ minimum: 1 }) })));
    if (result.value.length !== 1 || result.value[0] === undefined) throw new AzurePullError("Expected one active Azure PR for this session's source branch. Give a PR number.");
    return result.value[0].pullRequestId;
  }
  async pull(cwd: string, number: number): Promise<PullSnapshot> {
    if (!Number.isSafeInteger(number) || number < 1) throw new AzurePullError("Use a positive PR number.");
    const repo = await this.resolve(cwd);
    const base = `${this.gitBase(repo)}/pullrequests/${String(number)}`;
    const pr = await this.read(repo, `${base}?api-version=7.1`, prSchema);
    if (pr.pullRequestId !== number || pr.repository.name.toLowerCase() !== repo.repository.toLowerCase() || pr.repository.project.name.toLowerCase() !== repo.project.toLowerCase()) throw new AzurePullError("Azure DevOps returned a mismatched pull request.");
    const url = pr._links?.web?.href ?? `https://dev.azure.com/${encodeURIComponent(repo.organization)}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${String(number)}`;
    const artifact = `vstfs:///CodeReview/CodeReviewId/${pr.repository.project.id}/${String(number)}`;
    // Microsoft's Evaluations - List reference specifies 7.1-preview.1, not 7.1.
    const policies = await this.subRead(repo, `${this.projectBase(repo)}/_apis/policy/evaluations?${new URLSearchParams({ artifactId: artifact, "api-version": "7.1-preview.1" })}`, list(policySchema));
    const statuses = await this.subRead(repo, `${base}/statuses?api-version=7.1`, list(statusSchema));
    const threads = await this.subRead(repo, `${base}/threads?api-version=7.1`, list(threadSchema));
    const checks: PullCheck[] = [];
    for (const policy of policies?.value ?? []) {
      const state = policyStates[policy.status];
      if (state === undefined) continue;
      const build = policy.configuration.settings.buildDefinitionName;
      checks.push({ id: `policy:${policy.evaluationId}`, name: `${policy.configuration.type.displayName}${build === undefined ? "" : `: ${build}`}`, state, required: policy.configuration.isBlocking, url: policy._links?.web?.href ?? url, ...(policy.completedDate === undefined ? {} : { updatedAt: policy.completedDate }) });
    }
    // Status updates share a context. Keep its newest result, not an obsolete failure.
    const latest = new Map<string, Static<typeof statusSchema>>();
    for (const status of statuses?.value ?? []) {
      const key = `${status.context.genre ?? ""}:${status.context.name}`;
      const previous = latest.get(key);
      if (previous === undefined || status.id > previous.id) latest.set(key, status);
    }
    for (const [key, status] of latest) {
      const state = statusStates[status.state];
      if (state === undefined) continue;
      const updatedAt = status.updatedDate ?? status.creationDate;
      checks.push({ id: `status:${key}`, name: status.context.name, state, required: false, url: status.targetUrl ?? url, ...(updatedAt === undefined ? {} : { updatedAt }) });
    }
    const remarks: PullRemark[] = [];
    const comments: PullRemark[] = [];
    for (const thread of threads?.value ?? []) {
      if (thread.isDeleted === true) continue;
      for (const comment of thread.comments) {
        if (comment.isDeleted === true || comment.commentType !== "text") continue;
        const context = thread.threadContext;
        const line = context?.rightFileStart?.line ?? context?.leftFileStart?.line;
        const remark: PullRemark = { id: `thread:${String(thread.id)}:comment:${String(comment.id)}`, kind: "comment", author: comment.author.uniqueName ?? comment.author.displayName, body: (comment.content ?? "").slice(0, 8000), updatedAt: comment.lastUpdatedDate ?? comment.publishedDate, url: `${url}?discussionId=${String(thread.id)}`,
          ...(context?.filePath === undefined ? {} : { path: context.filePath }), ...(line === undefined ? {} : { line }) };
        remarks.push(remark);
        if (thread.status === "active" || thread.status === 1 || thread.status === undefined) comments.push(remark);
      }
    }
    const updatedAt = pr.closedDate ?? pr.creationDate;
    const pull: PullRequest = { repo: azureRepoKey(repo), number, title: pr.title.slice(0, 8000), url, state: pr.status === "completed" ? "merged" : pr.status === "abandoned" ? "closed" : pr.isDraft === true ? "draft" : "open",
      head: pr.sourceRefName.replace(/^refs\/heads\//u, ""), base: pr.targetRefName.replace(/^refs\/heads\//u, ""), headSha: pr.lastMergeSourceCommit.commitId, author: pr.createdBy.uniqueName ?? pr.createdBy.displayName, updatedAt,
      mergeability: pr.mergeStatus === "conflicts" ? "conflicting" : pr.mergeStatus === "succeeded" ? "clean" : "unknown", files: 0, additions: 0, deletions: 0, checks, comments,
      reviews: pr.reviewers.filter((reviewer) => [10, 5, -10, -5].includes(reviewer.vote)).map((reviewer) => ({ reviewer: reviewer.uniqueName ?? reviewer.displayName, state: reviewer.vote > 0 ? "approved" : "changes_requested", updatedAt })),
      complete: policies !== undefined && statuses !== undefined && threads !== undefined, merge: { kind: "blocked", reason: "Azure DevOps pull requests are read-only. Merge in Azure DevOps." } };
    return { pull, remarks };
  }
  private async resolve(cwd: string): Promise<AzureRepo> {
    const repo = await (this.deps.resolveRepo ?? originAzureRepo)(cwd);
    if (repo === undefined) throw new AzurePullError("This session's origin is not an Azure Repos remote.");
    return repo;
  }
  private projectBase(repo: AzureRepo): string { return `https://dev.azure.com/${encodeURIComponent(repo.organization.toLowerCase())}/${encodeURIComponent(repo.project)}`; }
  private gitBase(repo: AzureRepo): string { return `${this.projectBase(repo)}/_apis/git/repositories/${encodeURIComponent(repo.repository)}`; }
  private async subRead<T extends TSchema>(repo: AzureRepo, url: string, schema: T): Promise<Static<T> | undefined> {
    try { return await this.read(repo, url, schema); } catch { return undefined; }
  }
  private async read<T extends TSchema>(repo: AzureRepo, url: string, schema: T): Promise<Static<T>> {
    const organization = repo.organization.toLowerCase();
    const until = this.limitedUntil.get(organization) ?? 0;
    if (until > this.now()) throw new AzurePullError(`Azure DevOps rate limit reached. Retry after ${new Date(until).toISOString()}.`);
    const credential = await this.deps.credential(organization);
    if (!credential.ok) throw new AzurePullError(credential.message);
    try {
      const response = await this.deps.fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Basic ${Buffer.from(`:${credential.token}`).toString("base64")}`, Accept: "application/json" } });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = retry === null ? NaN : Number(retry);
          const date = retry === null ? NaN : Date.parse(retry);
          const next = Number.isFinite(seconds) && seconds >= 0 ? this.now() + seconds * 1000 : Number.isFinite(date) && date > this.now() ? date : this.now() + 60_000;
          this.limitedUntil.set(organization, Math.max(this.now() + 1000, next));
          throw new AzurePullError("Azure DevOps rate limit reached. Retry later.");
        }
        throw new AzurePullError(`Azure DevOps answered HTTP ${String(response.status)}. Check the PAT's Code: Read scope and project access.`);
      }
      const reader = response.body?.getReader();
      if (reader === undefined) throw new AzurePullError("Azure DevOps returned an empty response.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 8 * 1024 * 1024) throw new AzurePullError("Azure DevOps PR response exceeded 8 MiB.");
          chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Check(schema, value) || (response.headers.get("x-ms-continuationtoken") ?? "") !== "") throw new AzurePullError("Azure DevOps returned invalid or truncated PR data.");
      return value;
    } catch (error) {
      if (error instanceof AzurePullError) throw error;
      throw new AzurePullError("Azure DevOps PR could not be read within 30 seconds, or returned invalid data.");
    }
  }
}
