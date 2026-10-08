import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import type { BacklogAzureDevopsConfig } from "../../shared/backlog.js";
import type { AzureCredential } from "./azureDevopsPat.js";

const id = Type.Integer({ minimum: 1 });
const QuerySchema = Type.Object({ workItems: Type.Array(Type.Object({ id }), { maxItems: 501 }) });
const WorkItemSchema = Type.Object({ id, fields: Type.Object({
  "System.Title": Type.String(), "System.WorkItemType": Type.String({ minLength: 1 }),
  "System.State": Type.String({ minLength: 1 }), "System.TeamProject": Type.String(),
  "System.Description": Type.Optional(Type.String()),
  "Microsoft.VSTS.Common.AcceptanceCriteria": Type.Optional(Type.String()),
  "Microsoft.VSTS.TCM.ReproSteps": Type.Optional(Type.String()),
  "Microsoft.VSTS.Common.Priority": Type.Optional(Type.Integer()),
  "System.CreatedDate": Type.Optional(Type.String()), "System.Tags": Type.Optional(Type.String()),
}) });
const BatchSchema = Type.Object({ value: Type.Array(WorkItemSchema, { maxItems: 200 }) });
const StatesSchema = Type.Object({ value: Type.Array(Type.Object({ name: Type.String(), category: Type.String() }), { maxItems: 100 }) });
export type AzureWorkItem = Static<typeof WorkItemSchema> & { category: string | undefined };
export type AzureItemsResult = { ok: true; items: AzureWorkItem[]; truncated: boolean }
  | { ok: false; kind: "auth" | "unavailable"; message: string };

interface Dependencies {
  credential: (organization: string) => Promise<AzureCredential>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}
class AzureReadError extends Error {
  constructor(readonly kind: "auth" | "unavailable", message: string) { super(message); }
}
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Reads only. POSTs execute a query or retrieve a batch; no endpoint can mutate work items. */
export class AzureDevopsClient {
  private readonly limitedUntil = new Map<string, number>();
  private readonly now: () => number;
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }

  async assignedItems(config: BacklogAzureDevopsConfig): Promise<AzureItemsResult> {
    try {
      const organization = config.organization.toLowerCase();
      const credential = await this.deps.credential(organization);
      if (!credential.ok) return { ok: false, kind: "auth", message: credential.message };
      const until = this.limitedUntil.get(organization) ?? 0;
      if (until > this.now()) throw new AzureReadError("unavailable", `Azure DevOps rate limit reached. Retry after ${new Date(until).toISOString()}.`);
      const base = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(config.project)}/_apis/wit`;
      // One deadline for the entire scan, not 30 seconds for each batch or type.
      const signal = AbortSignal.timeout(30_000);
      const headers = { Authorization: `Basic ${Buffer.from(`:${credential.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(config.project)} AND [System.AssignedTo] = @Me${config.areaPath === undefined ? "" : ` AND [System.AreaPath] UNDER ${quote(config.areaPath)}`} ORDER BY [System.ChangedDate] DESC`;
      const read = <T extends TSchema>(path: string, schema: T, body?: unknown) => this.request(`${base}/${path}`, schema, organization,
        { headers, signal, redirect: "error", method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await read("wiql?api-version=7.1&$top=501", QuerySchema, { query });
      const ids = [...new Set(result.workItems.map((item) => item.id))].slice(0, 500);
      const items: Static<typeof WorkItemSchema>[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        // Omit `fields`: requested fields that do not exist for a custom process cause Azure to reject a batch.
        const batch = await read("workitemsbatch?api-version=7.1", BatchSchema, { ids: ids.slice(i, i + 200), errorPolicy: "Fail" });
        items.push(...batch.value);
      }
      if (items.length !== ids.length || new Set(items.map((item) => item.id)).size !== ids.length || items.some((item) => !ids.includes(item.id)
        || item.fields["System.TeamProject"].toLowerCase() !== config.project.toLowerCase())) {
        throw new AzureReadError("unavailable", "Azure DevOps returned an incomplete or mismatched work-item batch. Refresh the backlog.");
      }
      const types = [...new Set(items.map((item) => item.fields["System.WorkItemType"]))];
      if (types.length > 32) throw new AzureReadError("unavailable", "This Azure backlog has more than 32 work-item types. Narrow its areaPath.");
      const categories = new Map<string, Map<string, string>>();
      for (const type of types) {
        const states = await read(`workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`, StatesSchema);
        categories.set(type, new Map(states.value.map((state) => [state.name, state.category])));
      }
      // Check membership again after reading details: a reassignment during the batch must not offer a launch.
      if (ids.length > 0) {
        const current = await read("wiql?api-version=7.1&$top=501", QuerySchema, { query });
        const assigned = new Set(current.workItems.map((item) => item.id));
        return { ok: true, items: items.filter((item) => assigned.has(item.id)).map((item) => ({ ...item,
          category: categories.get(item.fields["System.WorkItemType"])?.get(item.fields["System.State"]) })), truncated: result.workItems.length > 500 || current.workItems.length > 500 };
      }
      return { ok: true, items: [], truncated: false };
    } catch (error) {
      // Never reflect Azure error bodies, fetch errors, or request headers. They can contain credentials or private data.
      return error instanceof AzureReadError ? { ok: false, kind: error.kind, message: error.message }
        : { ok: false, kind: "unavailable", message: "Azure DevOps could not be read within 30 seconds, or returned invalid data. Refresh the backlog." };
    }
  }

  private async request<T extends TSchema>(url: string, schema: T, organization: string, init: RequestInit): Promise<Static<T>> {
    const response = await this.deps.fetch(url, init);
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new AzureReadError("auth", "Azure DevOps rejected the PAT. Replace the expired or revoked token on the server, then refresh the backlog.");
      if (response.status === 403) throw new AzureReadError("auth", "Azure DevOps denied access. Check the PAT's organization, Work Items: Read scope, and your project permissions.");
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const seconds = Number(retry);
        const date = retry === null ? NaN : Date.parse(retry);
        const until = Number.isFinite(seconds) && seconds > 0 ? this.now() + seconds * 1000 : Number.isFinite(date) && date > this.now() ? date : this.now() + 60_000;
        this.limitedUntil.set(organization, until);
        throw new AzureReadError("unavailable", `Azure DevOps rate limit reached. Retry after ${new Date(until).toISOString()}.`);
      }
      throw new AzureReadError("unavailable", `Azure DevOps answered HTTP ${String(response.status)}. Check the organization and project, then refresh the backlog.`);
    }
    // Bound memory even when a proxy returns an HTML login page or an unexpectedly large description.
    const reader = response.body?.getReader();
    if (reader === undefined) throw new AzureReadError("unavailable", "Azure DevOps returned an empty response.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 8 * 1024 * 1024) throw new AzureReadError("unavailable", "Azure DevOps response exceeded 8 MiB. Narrow the backlog areaPath.");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Check(schema, value)) throw new AzureReadError("unavailable", "Azure DevOps returned an unexpected response. Refresh the backlog.");
    return value;
  }
}
