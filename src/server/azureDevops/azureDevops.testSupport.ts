import Fastify from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { AzureDevopsClient, type AzureWorkItem } from "./azureDevopsClient.js";

export const PAT = "testOnlyReadToken1234567890";
export const azureConfig = { organization: "amazeinsights", project: "Amaze Insights" };
export const workItem = (id = 7, fields: Partial<AzureWorkItem["fields"]> = {}) => ({ id, fields: {
  "System.Title": "Check incentive totals", "System.WorkItemType": "User Story", "System.State": "Active", "System.TeamProject": "Amaze Insights",
  "System.Description": "<p>Compare <b>current</b> totals &amp; adjustments.</p>",
  "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>No duplicate rows.</li></ul>",
  "System.CreatedDate": "2026-10-01T10:00:00Z", "System.Tags": "incentives; database", "Microsoft.VSTS.Common.Priority": 2, ...fields,
} });

const BatchRequest = Type.Object({ ids: Type.Array(Type.Integer()) });
interface ServerState {
  items: ReturnType<typeof workItem>[]; assigned: number[]; status: number; retryAfter: string; redirect: boolean;
  malformed: boolean; incomplete: boolean; category: string; afterQuery: (() => void) | undefined;
}

/** A real HTTP service with configurable work items and failures, exercising the production HTTP client. */
export async function azureServer() {
  const app = Fastify();
  const state: ServerState = {
    items: [workItem()], assigned: [7], status: 200, retryAfter: "60", redirect: false, malformed: false, incomplete: false,
    category: "InProgress", afterQuery: undefined,
  };
  const requests: { url: string; method: string; body: unknown; authorization: string | undefined }[] = [];
  app.all("/*", (request, reply) => {
    requests.push({ url: request.url, method: request.method, body: request.body, authorization: request.headers.authorization });
    if (state.redirect) return reply.code(302).header("location", "https://example.invalid/steal").send();
    if (state.status !== 200) return reply.code(state.status).header("retry-after", state.retryAfter).send({ error: `secret ${PAT}` });
    if (state.malformed) return { surprise: PAT };
    const path = new URL(request.url, "http://local").pathname;
    if (path.endsWith("/wiql")) {
      const result = { workItems: state.assigned.slice(0, 501).map((id) => ({ id })) };
      state.afterQuery?.();
      return result;
    }
    if (path.endsWith("/workitemsbatch")) {
      if (!Check(BatchRequest, request.body)) return reply.code(400).send();
      const ids = request.body.ids;
      return { value: state.incomplete ? [] : state.items.filter((item) => ids.includes(item.id)) };
    }
    if (path.endsWith("/states")) return { value: [
      { name: "Active", category: state.category }, { name: "Shipped", category: "Completed" }, { name: "Rejected", category: "Removed" },
    ] };
    return reply.code(404).send();
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const fetchLocal = (url: string, init: RequestInit) => {
    const target = new URL(url);
    if (target.origin !== "https://dev.azure.com" || init.redirect !== "error") throw new Error("Unsafe Azure destination");
    return fetch(`${address}${target.pathname}${target.search}`, init);
  };
  const client = new AzureDevopsClient({ credential: () => Promise.resolve({ ok: true, token: PAT }), fetch: fetchLocal });
  return { state, requests, client, fetch: fetchLocal, close: () => app.close() };
}
