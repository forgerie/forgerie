import { z } from "zod";
import { errorSchema, sessionModelSchema, sessionSchema, type Session, type SessionModel } from "./contracts";
import type { PromptAttachment } from "./attachments";
import { workspaceOf } from "./workspaceOf";

/** One project Forgerie knows, and one checkout of it. */
export const projectSchema = z.object({ id: z.string().min(1), name: z.string(), path: z.string().min(1) });
export const workspaceSchema = z.object({
  id: z.string().min(1), path: z.string().min(1), label: z.string(), branch: z.string().optional(), isMain: z.boolean().optional(),
});
export type Project = z.infer<typeof projectSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
/** Pi's choices for a session that will start in one folder. */
export const newSessionModelsSchema = z.object({
  models: z.array(sessionModelSchema), model: sessionModelSchema.optional(), thinkingLevel: z.string(),
});
export type NewSessionModels = z.infer<typeof newSessionModelsSchema>;

/** Where the new session starts. `label` is what a person reads. */
export interface Destination { cwd: string; label: string }
/** What the author picked before the session exists. Absent: Pi's default. */
export interface AgentChoice { model?: SessionModel | undefined; thinkingLevel?: string | undefined }

/**
 * Pi's thinking levels. Without a session, Pi cannot say which ones a model
 * allows, so a reasoning model offers all of them and the new session keeps
 * the nearest one it allows.
 */
export const KNOWN_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export function thinkingLevelsFor(model: SessionModel | undefined): string[] {
  return model?.reasoning === false ? ["off"] : [...KNOWN_THINKING_LEVELS];
}

/** The last folder segment, for a destination nobody has named yet. */
export function folderName(cwd: string): string {
  return cwd.replace(/\/+$/u, "").split("/").at(-1) || cwd;
}

/**
 * Name a folder the way the picker names a session's location: the project,
 * then the workspace when it is not the project's own folder.
 */
export function destinationLabel(cwd: string, projects: readonly Project[], workspaces: readonly Workspace[] = []): string {
  const workspace = workspaces.find((item) => item.path === cwd);
  const project = [...projects].sort((a, b) => b.path.length - a.path.length)
    .find((item) => cwd === item.path || cwd.startsWith(`${item.path}/`));
  if (!project) return folderName(cwd);
  if (cwd === project.path) return project.name;
  return `${project.name} · ${workspace?.branch ?? workspace?.label ?? folderName(cwd)}`;
}

/**
 * Where a new session starts when the author has not chosen: the open
 * session's folder, then the most recently used one, then the first project.
 */
export function defaultDestinationCwd(open: { cwd: string } | undefined, recent: readonly { cwd: string; modified?: string | undefined }[], projects: readonly Project[]): string | undefined {
  if (open) return open.cwd;
  const latest = [...recent].sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))[0];
  return latest?.cwd ?? projects[0]?.path;
}

/** A choice made in one folder survives a move only if the new folder offers that model. */
export function keepChoice(choice: AgentChoice, models: readonly SessionModel[]): AgentChoice {
  if (!choice.model) return choice;
  const still = models.some((model) => model.provider === choice.model?.provider && model.id === choice.model?.id);
  return still ? choice : { ...(choice.thinkingLevel ? { thinkingLevel: choice.thinkingLevel } : {}) };
}

/** Identifies one skill or prompt template, so Pi runs the one the folder listed. */
export const promptResourceIdentitySchema = z.object({ source: z.enum(["prompt", "skill"]), name: z.string().min(1), fingerprint: z.string().min(1) });
export type PromptResourceIdentity = z.infer<typeof promptResourceIdentitySchema>;
export const promptResourceSchema = z.object({ name: z.string().min(1), source: z.enum(["prompt", "skill"]),
  identity: promptResourceIdentitySchema, description: z.string().optional() });
export type PromptResource = z.infer<typeof promptResourceSchema>;
const promptResourceCatalogSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), commands: z.array(promptResourceSchema) }),
  z.object({ available: z.literal(false), message: z.string() }),
]);

/**
 * The first message. Images travel with it; other files are saved in the
 * session's folder first and named in the text. `command` marks a skill or
 * prompt template the folder listed.
 */
export interface FirstPrompt {
  text: string;
  images?: PromptAttachment[] | undefined;
  files?: PromptAttachment[] | undefined;
  command?: PromptResourceIdentity | undefined;
}

/**
 * Labels a create request so the server's startup progress events can be
 * matched to it. Built from `getRandomValues`, which works on plain http;
 * `randomUUID` does not.
 */
export function newStartupToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `start-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Files for a session that does not exist yet. The composer's attachment
 * adapter saves through `save`, which only holds the file and returns a
 * placeholder reference. `split` takes those references back out of the sent
 * text, so the start saves the files once the session exists.
 */
export function createDeferredFiles() {
  const held = new Map<string, PromptAttachment>();
  let count = 0;
  return {
    async save(attachment: PromptAttachment) {
      const path = `pending-upload/${String(++count)}/${attachment.name ?? "file"}`;
      held.set(path, attachment);
      return { path, mimeType: attachment.mimeType, size: Math.floor(attachment.data.length * 3 / 4) };
    },
    split(text: string): { text: string; files: PromptAttachment[] } {
      const files: PromptAttachment[] = [];
      const kept = text.split("\n").filter((line) => {
        const file = line.startsWith("@") ? held.get(line.slice(1)) : undefined;
        if (file) files.push(file);
        return !file;
      });
      return { text: kept.join("\n").trim(), files };
    },
  };
}
export type DeferredFiles = ReturnType<typeof createDeferredFiles>;

export type StartFailure = { stage: "start"; message: string; maybeStarted: boolean }
  | { stage: "prompt"; session: Session; message: string };
class Refusal extends Error { constructor(message: string, readonly status: number) { super(message); } }
/**
 * The create route answers 400 for request errors and for failures inside
 * the start itself, so a 4xx alone does not prove no session exists. Only the
 * route's own request checks do: a missing or malformed field, an unknown
 * model, or an unknown thinking level.
 */
const VALIDATION = /(\bis required\b|\bmust be\b|^Unknown model\b|^Model not found\b|^Unknown thinking level\b|^Invalid thinking level\b)/iu;
const refused = (error: unknown): error is Refusal => error instanceof Refusal && error.status >= 400 && error.status < 500
  && error.status !== 408 && error.status !== 429 && VALIDATION.test(error.message);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export type Fetch = (path: string, init?: RequestInit) => Promise<Response>;
/** The reads and writes of starting a session. Nothing here retries. */
export function createNewSessionApi(fetchFn: Fetch) {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, init);
    if (!response.ok) {
      const body = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Refusal(body.success ? body.data.error : `Request failed: HTTP ${response.status}`, response.status);
    }
    return schema.parse(await response.json());
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    projects: (signal?: AbortSignal) => call("/api/projects", z.array(projectSchema), signal ? { signal } : {}),
    workspaces: (projectId: string, signal?: AbortSignal) => call(`/api/projects/${encodeURIComponent(projectId)}/workspaces`, z.array(workspaceSchema), signal ? { signal } : {}),
    models: (cwd: string, signal?: AbortSignal) => call(`/api/models?${new URLSearchParams({ cwd })}`, newSessionModelsSchema, signal ? { signal } : {}),
    /** The skills and prompt templates a session started in this folder can run first. */
    async promptResources(cwd: string, signal: AbortSignal = new AbortController().signal): Promise<PromptResource[]> {
      const read = <T>(path: string, schema: z.ZodType<T>, inner: AbortSignal) => call(path, schema, { signal: inner });
      const target = await workspaceOf(cwd, read, signal);
      const catalog = await read(`/api/projects/${encodeURIComponent(target.projectId)}/workspaces/${encodeURIComponent(target.workspaceId)}/prompt-resource-catalog`,
        promptResourceCatalogSchema, signal);
      if (!catalog.available) throw new Error(catalog.message);
      return catalog.commands;
    },
    /**
     * Create the session, then send its first message. A failure says which
     * step failed and whether a session may exist, so the caller never repeats
     * a step that may have worked.
     */
    async start(cwd: string, first: string | FirstPrompt, choice: AgentChoice, options: { startupToken?: string } = {}): Promise<{ type: "started"; session: Session } | { type: "failed"; failure: StartFailure }> {
      const prompt: FirstPrompt = typeof first === "string" ? { text: first } : first;
      let session: Session;
      try {
        const modelSpec = choice.model?.provider && choice.model.id ? `${choice.model.provider}/${choice.model.id}` : undefined;
        session = await call("/api/sessions", sessionSchema, post({ cwd, ...(options.startupToken ? { startupToken: options.startupToken } : {}),
          ...(modelSpec ? { modelSpec } : {}), ...(choice.thinkingLevel ? { thinkingLevel: choice.thinkingLevel } : {}) }));
      } catch (error) {
        return { type: "failed", failure: { stage: "start", message: messageOf(error), maybeStarted: !refused(error) } };
      }
      const root = `/api/sessions/${encodeURIComponent(session.id)}`;
      try {
        let text = prompt.text;
        if (prompt.files?.length) {
          const saved = await call(`${root}/attachments`, z.object({ attachments: z.array(z.object({ path: z.string().min(1) })).length(prompt.files.length) }),
            post({ cwd: session.cwd, attachments: prompt.files }));
          text = [text, ...saved.attachments.map((file) => `@${file.path}`)].join("\n");
        }
        const images = prompt.images?.length ? { attachments: prompt.images } : {};
        if (prompt.command) await call(`${root}/prompt-resource-command`, z.object({ accepted: z.literal(true) }),
          post({ cwd: session.cwd, text, identity: prompt.command, ...images }));
        else await call(`${root}/prompt`, z.object({ accepted: z.literal(true) }), post({ cwd: session.cwd, text, ...images }));
      } catch (error) {
        return { type: "failed", failure: { stage: "prompt", session, message: messageOf(error) } };
      }
      return { type: "started", session };
    },
  };
}
export type NewSessionApi = ReturnType<typeof createNewSessionApi>;
