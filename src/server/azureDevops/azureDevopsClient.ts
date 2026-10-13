import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { AZURE_IMAGE_BYTES, AZURE_LAUNCH_IMAGE_BYTES, AZURE_LAUNCH_IMAGES, azureImageMime, azureImageSource, type AzureWorkItemImageRef } from "./azureWorkItemImages.js";
import { base64ByteLength } from "../../shared/promptAttachments.js";
import type { BacklogLaunchContent } from "../../shared/backlog.js";
import type { BacklogAzureDevopsConfig, BacklogScope } from "../../shared/backlog.js";
import type { AzureCredentialSource } from "./azureDevopsCredentials.js";
import { azureDevopsRequest } from "./azureDevopsRequest.js";

const id = Type.Integer({ minimum: 1 });
const QuerySchema = Type.Object({ workItems: Type.Array(Type.Object({ id }), { maxItems: 501 }) });
const WorkItemSchema = Type.Object({ id, fields: Type.Object({
  "System.Title": Type.String(), "System.WorkItemType": Type.String({ minLength: 1 }),
  "System.State": Type.String({ minLength: 1 }), "System.TeamProject": Type.String(),
  "System.AssignedTo": Type.Optional(Type.Union([Type.String(), Type.Object({ displayName: Type.String() })])),
  "System.Description": Type.Optional(Type.String()),
  "Microsoft.VSTS.Common.AcceptanceCriteria": Type.Optional(Type.String()),
  "Microsoft.VSTS.TCM.ReproSteps": Type.Optional(Type.String()),
  "Microsoft.VSTS.Common.Priority": Type.Optional(Type.Integer()),
  "System.CreatedDate": Type.Optional(Type.String()), "System.Tags": Type.Optional(Type.String()),
  "Microsoft.VSTS.Common.ClosedDate": Type.Optional(Type.Union([Type.String(), Type.Null()])),
}) });
const BatchSchema = Type.Object({ value: Type.Array(WorkItemSchema, { maxItems: 200 }) });
const TypesSchema = Type.Object({ value: Type.Array(Type.Object({ name: Type.String() }), { maxItems: 32 }) });
const StatesSchema = Type.Object({ value: Type.Array(Type.Object({ name: Type.String(), category: Type.String() }), { maxItems: 100 }) });
export type AzureWorkItem = Static<typeof WorkItemSchema> & { category: string | undefined; assignedToMe: boolean };
export type AzureItemsResult = { ok: true; items: AzureWorkItem[]; truncated: boolean }
  | { ok: false; kind: "auth" | "unavailable"; message: string };

export interface AzureImagesResult {
  attached: { ref: AzureWorkItemImageRef; image: NonNullable<BacklogLaunchContent["images"]>[number] }[];
  skipped: { ref: AzureWorkItemImageRef; reason: string }[];
}
interface Dependencies {
  credentials: AzureCredentialSource;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}
class AzureReadError extends Error {
  constructor(readonly kind: "auth" | "unavailable", message: string) { super(message); }
}
const wiql = (predicates: readonly string[]) => `SELECT [System.Id] FROM WorkItems WHERE ${predicates.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Reads only. POSTs execute a query or retrieve a batch; no endpoint can mutate work items. */
export class AzureDevopsClient {
  private readonly limitedUntil = new Map<string, number>();
  private readonly now: () => number;
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }

  async assignedItems(config: BacklogAzureDevopsConfig, scope: BacklogScope = "mine"): Promise<AzureItemsResult> {
    try {
      const organization = config.organization.toLowerCase();
      const until = this.limitedUntil.get(organization) ?? 0;
      if (until > this.now()) throw new AzureReadError("unavailable", `Azure DevOps rate limit reached. Retry after ${new Date(until).toISOString()}.`);
      const base = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(config.project)}/_apis/wit`;
      // One deadline for the entire scan, not 30 seconds for each batch or type.
      const signal = AbortSignal.timeout(30_000);
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      const project = `[System.TeamProject] = ${quote(config.project)}`;
      const area = config.areaPath === undefined ? [] : [`[System.AreaPath] UNDER ${quote(config.areaPath)}`];
      const minePredicates = [project, "[System.AssignedTo] = @Me", ...area];
      const mineQuery = wiql(minePredicates);
      const read = <T extends TSchema>(path: string, schema: T, body?: unknown) => this.request(`${base}/${path}`, schema, organization,
        { headers, signal, redirect: "error", method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const categories = new Map<string, Map<string, string>>();
      const readStates = async (type: string) => {
        const states = await read(`workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`, StatesSchema);
        categories.set(type, new Map(states.value.map((state) => [state.name, state.category])));
      };
      let query = mineQuery;
      if (scope === "everyone") {
        // State names are process-specific. Discover all types before the broad query so closed
        // items never consume its 500-item budget. Mine still touches only assigned items.
        const types = await read("workitemtypes?api-version=7.1", TypesSchema);
        for (const type of types.value) await readStates(type.name);
        const closed = [...new Set([...categories.values()].flatMap((states) => [...states].filter(([, category]) => category === "Completed" || category === "Removed").map(([name]) => name)))];
        query = wiql([project, ...area, ...(closed.length === 0 ? [] : [`[System.State] NOT IN (${closed.map(quote).join(", ")})`]), "[Microsoft.VSTS.Common.ClosedDate] = ''"]);
      }
      const result = await read("wiql?api-version=7.1&$top=501", QuerySchema, { query });
      const ids = [...new Set(result.workItems.map((item) => item.id))].slice(0, 500);
      const items: Static<typeof WorkItemSchema>[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        // Omitting `fields` requests all fields, including ClosedDate. A restrictive list can
        // make Azure reject optional fields that do not exist for a custom process.
        const batch = await read("workitemsbatch?api-version=7.1", BatchSchema, { ids: ids.slice(i, i + 200), errorPolicy: "Fail" });
        items.push(...batch.value);
      }
      if (items.length !== ids.length || new Set(items.map((item) => item.id)).size !== ids.length || items.some((item) => !ids.includes(item.id)
        || item.fields["System.TeamProject"].toLowerCase() !== config.project.toLowerCase())) {
        throw new AzureReadError("unavailable", "Azure DevOps returned an incomplete or mismatched work-item batch. Refresh the backlog.");
      }
      const types = [...new Set(items.map((item) => item.fields["System.WorkItemType"]))];
      if (types.length > 32) throw new AzureReadError("unavailable", "This Azure backlog has more than 32 work-item types. Narrow its areaPath.");
      for (const type of types) if (!categories.has(type)) await readStates(type);
      // Check membership again after reading details: a reassignment during the batch must not offer a launch.
      if (ids.length > 0) {
        const current = await read("wiql?api-version=7.1&$top=501", QuerySchema, { query });
        const assigned = new Set(current.workItems.map((item) => item.id));
        const mine = scope === "mine" ? assigned : new Set((await read("wiql?api-version=7.1&$top=501", QuerySchema, { query: wiql([...minePredicates, `[System.Id] IN (${ids.join(", ")})`]) })).workItems.map((item) => item.id));
        return { ok: true, items: items.filter((item) => assigned.has(item.id)).map((item) => ({ ...item,
          assignedToMe: mine.has(item.id), category: categories.get(item.fields["System.WorkItemType"])?.get(item.fields["System.State"]) })), truncated: result.workItems.length > 500 || current.workItems.length > 500 };
      }
      if (scope === "everyone") await read("wiql?api-version=7.1&$top=501", QuerySchema, { query: mineQuery });
      return { ok: true, items: [], truncated: false };
    } catch (error) {
      // Never reflect Azure error bodies, fetch errors, or request headers. They can contain credentials or private data.
      return error instanceof AzureReadError ? { ok: false, kind: error.kind, message: error.message }
        : { ok: false, kind: "unavailable", message: "Azure DevOps could not be read within 30 seconds, or returned invalid data. Refresh the backlog." };
    }
  }

  async workItemImages(organization: string, refs: readonly AzureWorkItemImageRef[]): Promise<AzureImagesResult> {
    const result: AzureImagesResult = { attached: [], skipped: [] };
    const signal = AbortSignal.timeout(30_000);
    let total = 0;
    let candidates = 0;
    for (const ref of refs) {
      const source = azureImageSource(ref.url, organization);
      if (source.kind === "skipped") { result.skipped.push({ ref, reason: source.reason }); continue; }
      if (candidates++ >= AZURE_LAUNCH_IMAGES) { result.skipped.push({ ref, reason: "10-image launch limit" }); continue; }
      const remaining = Math.max(0, AZURE_LAUNCH_IMAGE_BYTES - total);
      const cap = Math.min(AZURE_IMAGE_BYTES, remaining);
      const limitReason = remaining < AZURE_IMAGE_BYTES ? "20 MiB launch size limit" : "10 MiB image size limit";
      try {
        signal.throwIfAborted();
        if (cap === 0) throw new Error(limitReason);
        let bytes: Buffer;
        if (source.kind === "data") {
          if (base64ByteLength(source.data) > cap) { result.skipped.push({ ref, reason: limitReason }); continue; }
          bytes = Buffer.from(source.data, "base64");
        } else {
          const response = await this.response(source.url, organization.toLowerCase(), { method: "GET", redirect: "error", signal });
          if (Number(response.headers.get("content-length")) > cap) { await response.body?.cancel(); result.skipped.push({ ref, reason: limitReason }); continue; }
          const reader = response.body?.getReader();
          if (reader === undefined) throw new Error("empty image response");
          const chunks: Uint8Array[] = [];
          let length = 0;
          let tooLarge = false;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              length += next.value.length;
              total += next.value.length;
              if (length > cap) { tooLarge = true; break; }
              chunks.push(next.value);
            }
          } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
          if (tooLarge) { result.skipped.push({ ref, reason: limitReason }); continue; }
          bytes = Buffer.concat(chunks);
        }
        if (source.kind === "data") total += bytes.length;
        const mimeType = azureImageMime(bytes);
        if (mimeType === undefined) { result.skipped.push({ ref, reason: "unsupported or unknown image type" }); continue; }
        result.attached.push({ ref, image: { kind: "image", name: ref.name, mimeType, data: bytes.toString("base64") } });
      } catch (error) {
        result.skipped.push({ ref, reason: error instanceof AzureReadError ? error.message : signal.aborted ? "30-second image read deadline" : cap === 0 ? limitReason : "image read failed" });
      }
    }
    return result;
  }

  private async response(url: string, organization: string, init: RequestInit): Promise<Response> {
    const until = this.limitedUntil.get(organization) ?? 0;
    if (until > this.now()) throw new AzureReadError("unavailable", "Azure DevOps rate limit reached; try again later.");
    const result = await azureDevopsRequest(this.deps.credentials, organization, url, init, this.deps.fetch);
    if (!result.ok) throw new AzureReadError("auth", result.message);
    const response = result.response;
    if (response.redirected) { await response.body?.cancel(); throw new AzureReadError("unavailable", "Attachment redirects are not allowed."); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403) throw new AzureReadError("auth", `Azure DevOps denied access. Check your project permissions and the PAT's Work Items: Read scope if using a PAT. ${this.deps.credentials.fixMessage(organization)}`);
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
    return response;
  }

  private async request<T extends TSchema>(url: string, schema: T, organization: string, init: RequestInit): Promise<Static<T>> {
    const response = await this.response(url, organization, init);
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
