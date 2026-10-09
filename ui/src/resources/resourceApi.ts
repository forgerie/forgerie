// The one file that knows the resource-editor wire contract
// (src/shared/resourceEditor.ts, documented in docs/resource-editor-api.md).
// Everything else in this client reads the types below.
import { z } from "zod";

const text = z.string().min(1);
const id = z.string().regex(/^[a-f0-9]{64}$/u);

export const resourceKinds = ["skill", "prompt", "context"] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export type OriginKind = "user" | "project" | "package" | "bundled";

const entrySchema = z.object({
  id,
  kind: z.enum(resourceKinds),
  name: text,
  description: z.string(),
  path: text,
  origin: z.object({ kind: z.enum(["user", "project", "package", "bundled"]), source: text, scope: z.string(), root: text }),
  activation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("active") }),
    z.object({ kind: z.literal("shadowed"), winnerId: id }),
    z.object({ kind: z.literal("disabled") }),
    z.object({ kind: z.literal("invalid"), message: text }),
  ]),
  manual: z.boolean(),
  edit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("writable"), saveEffect: z.enum(["file-only", "uncommitted", "commit"]) }),
    z.object({ kind: z.literal("read-only"), reason: text }),
  ]),
});
export type ResourceEntry = z.infer<typeof entrySchema>;

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("settings") }),
  z.object({ kind: z.literal("session"), sessionId: text, cwd: text }),
]);
export type ResourceScope = z.infer<typeof scopeSchema>;

const inventorySchema = z.object({
  scope: scopeSchema,
  resources: z.array(entrySchema),
  diagnostics: z.array(z.string()),
  maxFileBytes: z.number().int().positive(),
});
export type ResourceInventory = z.infer<typeof inventorySchema>;

const fileSchema = z.object({ resource: entrySchema, text: z.string(), revision: id });
export type ResourceFile = z.infer<typeof fileSchema>;

const saveSchema = z.object({
  file: fileSchema,
  effect: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unchanged") }),
    z.object({ kind: z.literal("file-only") }),
    z.object({ kind: z.literal("uncommitted") }),
    z.object({ kind: z.literal("committed"), sha: text, branch: text }),
  ]),
});
export type ResourceSave = z.infer<typeof saveSchema>;
export type SaveEffect = ResourceSave["effect"];

export const errorKinds = ["invalid-request", "not-found", "read-only", "conflict", "over-limit", "unsafe-git-state", "commit-failed", "io-error", "busy"] as const;
export type ResourceErrorKind = (typeof errorKinds)[number] | "unknown";
const errorSchema = z.object({ error: z.object({ kind: z.enum(errorKinds), message: text, savedToDisk: z.boolean() }) });

/** A refused request, with the server's words. `savedToDisk` says whether the file changed anyway. */
export class ResourceRequestError extends Error {
  constructor(readonly kind: ResourceErrorKind, message: string, readonly savedToDisk: boolean) { super(message); }
}

export type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Where the editor reads and writes: Settings, or one session's own checkout. */
export type ResourceTarget = { kind: "settings" } | { kind: "session"; sessionId: string };

const base = (target: ResourceTarget) => target.kind === "settings" ? "/api/resources" : `/api/sessions/${encodeURIComponent(target.sessionId)}/resources`;

export function createResourceApi(request: Fetch) {
  async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await request(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(120_000) });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const refused = errorSchema.safeParse(body);
      if (refused.success) throw new ResourceRequestError(refused.data.error.kind, refused.data.error.message, refused.data.error.savedToDisk);
      const message = z.object({ error: z.string() }).safeParse(body).data?.error ?? z.object({ message: z.string() }).safeParse(body).data?.message;
      throw new ResourceRequestError("unknown", message ?? `Request failed: ${String(response.status)}`, false);
    }
    return schema.parse(body);
  }
  return {
    list: (target: ResourceTarget, signal?: AbortSignal) => call(base(target), inventorySchema, signal ? { signal } : undefined),
    read: (target: ResourceTarget, resourceId: string, signal?: AbortSignal) => call(`${base(target)}/${resourceId}`, fileSchema, signal ? { signal } : undefined),
    save: (target: ResourceTarget, resourceId: string, text: string, baseRevision: string) => call(`${base(target)}/${resourceId}`, saveSchema,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, baseRevision }) }),
  };
}
export type ResourceApi = ReturnType<typeof createResourceApi>;
