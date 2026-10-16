import Fastify from "fastify";
import { AzurePullReader } from "./azurePullReader.js";
import { azureConfig, PAT, patCredentialSource } from "./azureDevops.testSupport.js";

export const AZURE_TIME = "2026-10-07T12:00:00.000Z";
export const azureRepo = { ...azureConfig, repository: "portal-source" };
export const azurePr = () => ({ pullRequestId: 9, title: "Fix tests", status: "active", isDraft: false, mergeStatus: "succeeded", sourceRefName: "refs/heads/fix", targetRefName: "refs/heads/main", lastMergeSourceCommit: { commitId: "a".repeat(40) }, createdBy: { displayName: "Owner", uniqueName: "owner@example.test" }, creationDate: AZURE_TIME, repository: { name: azureRepo.repository, project: { id: "project-id", name: azureRepo.project } }, reviewers: [10, 5, -10, -5, 0].map((vote, id) => ({ displayName: `Reviewer ${String(id)}`, vote })) });
export const azurePolicy = (status = "approved", isBlocking = true, id = "1") => ({ evaluationId: id, status, configuration: { isBlocking, type: { displayName: "Build" }, settings: { buildDefinitionName: "Tests" } } });
export const azureStatus = (state = "succeeded", id = 1) => ({ id, state, context: { name: `status-${String(id)}`, genre: "ci" }, updatedDate: AZURE_TIME });
export const azureThread = (id = 1) => ({ id, status: "active", threadContext: { filePath: "/a.ts", rightFileStart: { line: 3 } }, comments: [{ id: 1, commentType: "text", isDeleted: false, author: { displayName: "Human" }, content: "Rename it.", publishedDate: "2026-10-07T12:01:00.000Z" }] });

/** In-process Azure HTTP service; the injected transport cannot reach any remote host. */
export async function azurePullServer() {
  const app = Fastify();
  const state = { pr: azurePr(), policies: [azurePolicy()], statuses: [azureStatus()], threads: [azureThread()], status: 200, failurePath: "", retryAfter: "120", malformed: false, continuation: false, active: [9], open: [azurePr()] };
  const requests: { url: string; method: string }[] = [];
  app.all("/*", (request, reply) => {
    requests.push({ url: request.url, method: request.method });
    if (request.method !== "GET") return reply.code(405).send();
    if (state.status !== 200 && (state.failurePath === "" || request.url.includes(state.failurePath))) return reply.code(state.status).header("retry-after", state.retryAfter).send({ secret: PAT });
    if (state.malformed) return { secret: PAT };
    if (state.continuation) reply.header("x-ms-continuationtoken", "more");
    const path = new URL(request.url, "http://local").pathname;
    if (path.endsWith("/evaluations")) return { value: state.policies };
    if (path.endsWith("/statuses")) return { value: state.statuses };
    if (path.endsWith("/threads")) return { value: state.threads };
    if (path.endsWith("/pullrequests")) return { value: new URL(request.url, "http://local").searchParams.has("$top") ? state.open : state.active.map((pullRequestId) => ({ pullRequestId })) };
    return state.pr;
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const fetchLocal = (url: string, init: RequestInit) => {
    const target = new URL(url);
    if (target.origin !== "https://dev.azure.com" || init.redirect !== "error") throw new Error("Unsafe Azure destination");
    return fetch(`${address}${target.pathname}${target.search}`, init);
  };
  let now = Date.parse(AZURE_TIME);
  const reader = new AzurePullReader({ credentials: patCredentialSource(), fetch: fetchLocal, now: () => now, resolveRepo: () => Promise.resolve(azureRepo), branch: () => Promise.resolve("fix") });
  return { state, requests, reader, fetch: fetchLocal, advance: (ms: number) => { now += ms; }, close: () => app.close() };
}
