import { afterEach, describe, expect, it } from "vitest";
import { AzureDevopsClient } from "./azureDevopsClient.js";
import { azureConfig, azureServer, PAT, workItem, patCredentialSource } from "./azureDevops.testSupport.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function server() { const service = await azureServer(); cleanups.push(service.close); return service; }

describe("assigned Azure work items", () => {
  it("uses the PAT owner's identity, reads all types and custom states, and makes no mutation request", async () => {
    const s = await server();
    s.state.items = [workItem(), workItem(8, { "System.WorkItemType": "Bug", "System.State": "Shipped" }), workItem(9, { "System.WorkItemType": "Task" })];
    s.state.assigned = [7, 8, 9];
    const result = await s.client.assignedItems(azureConfig);
    expect(result).toMatchObject({ ok: true, truncated: false, items: [{ id: 7, category: "InProgress" }, { id: 8, category: "Completed" }, { id: 9 }] });
    expect(s.requests[0]?.body).toEqual({ query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Amaze Insights' AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC" });
    expect(s.requests.every((request) => request.authorization === `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`)).toBe(true);
    expect(s.requests.every((request) => request.method === "GET" || request.method === "POST" && /\/(wiql|workitemsbatch)\?/u.test(request.url))).toBe(true);
    expect(s.requests[0]?.url).toContain("/amazeinsights/Amaze%20Insights/_apis/wit/wiql");
  });

  it("quotes configuration instead of letting a project or area become WIQL", async () => {
    const s = await server(); s.state.assigned = [];
    await s.client.assignedItems({ organization: "AMAZEINSIGHTS", project: "Owner's project", areaPath: "Owner's project\\Team's area" });
    expect(s.requests[0]?.body).toEqual({ query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Owner''s project' AND [System.AssignedTo] = @Me AND [System.AreaPath] UNDER 'Owner''s project\\Team''s area' ORDER BY [System.ChangedDate] DESC" });
  });

  it("drops an item reassigned during a read instead of offering it to a session", async () => {
    const s = await server(); s.state.afterQuery = () => { s.state.assigned = []; };
    expect(await s.client.assignedItems(azureConfig)).toEqual({ ok: true, items: [], truncated: false });
  });

  it("reads batches of at most 200 and reports truncation rather than silently losing older items", async () => {
    const s = await server();
    s.state.items = Array.from({ length: 501 }, (_, index) => workItem(index + 1));
    s.state.assigned = s.state.items.map((item) => item.id);
    const result = await s.client.assignedItems(azureConfig);
    expect(result.ok && result.items.length).toBe(500);
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(s.requests.filter((request) => request.url.includes("workitemsbatch")).map((request) => request.body)).toEqual([
      { ids: Array.from({ length: 200 }, (_, i) => i + 1), errorPolicy: "Fail" },
      { ids: Array.from({ length: 200 }, (_, i) => i + 201), errorPolicy: "Fail" },
      { ids: Array.from({ length: 100 }, (_, i) => i + 401), errorPolicy: "Fail" },
    ]);
  });

  it.each([401, 403])("reports HTTP %i as an access failure and never returns the secret body", async (status) => {
    const s = await server(); s.state.status = status;
    const result = await s.client.assignedItems(azureConfig);
    expect(result).toMatchObject({ ok: false, kind: "auth" });
    expect(JSON.stringify(result)).not.toContain(PAT);
    s.state.status = 200;
    expect(await s.client.assignedItems(azureConfig)).toMatchObject({ ok: true });
  });

  it("waits for Retry-After and reads a newly replaced token without caching the old list", async () => {
    const s = await server(); let now = 0; let token = PAT;
    const client = new AzureDevopsClient({ credentials: patCredentialSource(() => token), fetch: s.fetch, now: () => now });
    s.state.status = 429; s.state.retryAfter = "120";
    expect(await client.assignedItems(azureConfig)).toMatchObject({ ok: false, kind: "unavailable" });
    s.state.status = 200;
    await client.assignedItems(azureConfig);
    expect(s.requests).toHaveLength(1);
    now = 120_001; token = "replacementReadToken123456";
    expect(await client.assignedItems(azureConfig)).toMatchObject({ ok: true });
    expect(s.requests[1]?.authorization).toBe(`Basic ${Buffer.from(`:${token}`).toString("base64")}`);
  });

  it.each(["redirect", "malformed", "incomplete"] as const)("refuses a %s reply without leaking credentials", async (kind) => {
    const s = await server(); s.state[kind] = true;
    const result = await s.client.assignedItems(azureConfig);
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
    expect(JSON.stringify(result)).not.toContain(PAT);
  });

  it("does not send any request without credentials", async () => {
    const s = await server();
    const client = new AzureDevopsClient({ credentials: { ...patCredentialSource(), read: () => Promise.resolve({ ok: false, message: "Store the read-only PAT on the server." }) }, fetch: s.fetch });
    expect(await client.assignedItems(azureConfig)).toMatchObject({ ok: false, kind: "auth" });
    expect(s.requests).toHaveLength(0);
  });
});

it("Everyone excludes closed states in WIQL and marks only @Me ids without connectionData", async () => {
  const s = await server(); s.state.items = [workItem(), workItem(8)]; s.state.assigned = [7]; s.state.everyone = [7, 8];
  const result = await s.client.assignedItems({ ...azureConfig, areaPath: "Amaze Insights\\Team" }, "everyone");
  expect(result).toMatchObject({ ok: true, items: [{ id: 7, assignedToMe: true }, { id: 8, assignedToMe: false }] });
  const queries = s.requests.filter((r) => r.url.includes("/wiql")).map((r) => JSON.stringify(r.body));
  expect(queries).toHaveLength(3);
  expect(queries[0]).not.toContain("@Me"); expect(queries[0]).toContain("[System.State] NOT IN ('Shipped', 'Rejected')");
  expect(queries[0]).toContain("[System.AreaPath] UNDER"); expect(queries[2]).toContain("@Me"); expect(queries[2]).toContain("[System.Id] IN (7, 8)");
  expect(s.requests.some((r) => r.url.includes("connectionData"))).toBe(false);
});

it.each(["$&", "$`", "$'", " ORDER BY"].flatMap((token) => ["project", "area", "state"].map((field) => ({ token, field }))))(
  "keeps $token literal in $field for Everyone and the identity WIQL", async ({ token, field }) => {
    const s = await server();
    const project = `Owner's Product${field === "project" ? token : ""}`;
    const areaPath = `Owner's Product\\Team's Area${field === "area" ? token : ""}`;
    const closed = `Closed owner's state${field === "state" ? token : ""}`;
    s.state.closedState = closed;
    s.state.items = [workItem(7, { "System.TeamProject": project })];
    const result = await s.client.assignedItems({ organization: "example", project, areaPath }, "everyone");
    expect(result).toMatchObject({ ok: true, items: [{ id: 7, assignedToMe: true }] });
    const queries = s.requests.filter((request) => request.url.includes("/wiql")).map((request) => request.body);
    const literal = (value: string) => "'" + value.split("'").join("''") + "'";
    const bounds = `[System.TeamProject] = ${literal(project)}`;
    const area = `[System.AreaPath] UNDER ${literal(areaPath)}`;
    const select = "SELECT [System.Id] FROM WorkItems WHERE ";
    const order = " ORDER BY [System.ChangedDate] DESC";
    const everyone = select + bounds + " AND " + area + ` AND [System.State] NOT IN (${literal(closed)}, 'Rejected')` + order;
    const identity = select + bounds + " AND [System.AssignedTo] = @Me AND " + area + " AND [System.Id] IN (7)" + order;
    expect(queries).toEqual([{ query: everyone }, { query: everyone }, { query: identity }]);
  },
);
