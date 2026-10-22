import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Check } from "typebox/value";
import { SuggestBacklogInputSchema, type SuggestBacklogInput, type BacklogSuggestion, type BacklogSuggestionAction, type BacklogSuggestionActRequest, type BacklogSuggestionFileRequest, type BacklogSuggestionModel, type BacklogSuggestionsQuery } from "../../../shared/backlogSuggestions.js";
import type { FileIssueInput, FileIssueResult } from "../../../shared/fileIssues.js";
import type { ProjectService } from "../../projects/projectService.js";
import type { SessionWorktrees } from "../../workspaces/sessionWorktrees.js";
import type { BacklogService } from "../backlogService.js";
import { BacklogError } from "../backlogError.js";
import { canonicalBacklogRoot } from "../backlogScanner.js";
import { resolveBacklogConfig } from "../backlogConfig.js";
import type { BacklogSettingsStore } from "../backlogSettingsStore.js";
import { DEFAULT_BACKLOG_DIRECTORY } from "../markdownBacklog.js";
import { suggestionBody, suggestionItemId, writeMarkdownSuggestion } from "./markdownWriter.js";
import { recoverMarkdownSuggestions } from "./markdownRecovery.js";
import type { BacklogSuggestionStore } from "./suggestionStore.js";

export interface SuggestionSessionContext { sessionTitle?: string; modelSpec?: string; thinkingLevel?: string }
interface Dependencies {
  store: BacklogSuggestionStore;
  projects: Pick<ProjectService, "list" | "requireProject">;
  settings: BacklogSettingsStore;
  worktrees: Pick<SessionWorktrees, "options" | "withMainCheckout">;
  backlog: Pick<BacklogService, "launchInBackground">;
  githubRepo: (cwd: string) => Promise<string>;
  onRecoveryError?: (projectId: string, error: unknown) => void;
  fileIssue: (cwd: string, sessionId: string, input: FileIssueInput, repo: string) => Promise<FileIssueResult & { decisionLogWarning?: string }>;
}
export class BacklogSuggestionService {
  private readonly pending = new Map<string, Promise<BacklogSuggestion>>();
  constructor(private readonly deps: Dependencies) {}
  list(query: BacklogSuggestionsQuery = {}): BacklogSuggestion[] {
    return this.deps.store.list().filter(record => (query.sessionId === undefined || record.sessionId === query.sessionId) && (query.state === undefined || record.state.kind === query.state));
  }
  /** Finish local crash recovery before sessiond admits HTTP requests or resumed tool calls. */
  async recoverStartup(): Promise<void> {
    const blockedProjects = new Set<string>();
    for (const project of await this.deps.projects.list()) {
      const records = this.deps.store.list().filter(record => record.projectId === project.id);
      try {
        for (const recovered of await recoverMarkdownSuggestions(this.deps.worktrees, project, records)) {
          const record = this.deps.store.require(recovered.id);
          await this.deps.store.update({ ...record, state: recovered.state });
        }
      } catch (error) {
        if (this.deps.onRecoveryError === undefined) throw error;
        this.deps.onRecoveryError(project.id, error); blockedProjects.add(project.id);
      }
    }
    for (let record of this.deps.store.list()) {
      if (record.destination.provider !== "markdown" || blockedProjects.has(record.projectId)) continue;
      const receipt = this.deps.store.pendingReceipt(record.id);
      if (receipt === undefined || record.state.kind === "filing") continue;
      if (record.state.kind === "filed" && receipt.action === "file-and-act" && receipt.input !== undefined) record = await this.launchFiled(record, receipt.input);
      await this.deps.store.update(record, { ...receipt, result: record });
    }
  }
  async suggest(cwd: string, sessionId: string, input: SuggestBacklogInput, session: SuggestionSessionContext = {}): Promise<BacklogSuggestion> {
    if (!Check(SuggestBacklogInputSchema, input)) throw new BacklogError("invalid-request", "Invalid backlog suggestion");
    const repo = await canonicalBacklogRoot(cwd);
    const projects = await this.deps.projects.list();
    let project: Awaited<ReturnType<ProjectService["requireProject"]>> | undefined;
    for (const candidate of projects) {
      if (await canonicalBacklogRoot(candidate.path).catch(() => undefined) === repo) { project = candidate; break; }
    }
    if (project === undefined) throw new BacklogError("invalid-request", "Suggestions require a registered project");
    const projectId = project.id;
    const settings = await this.deps.settings.read();
    const config = (await resolveBacklogConfig(project, repo, { read: () => Promise.resolve(settings) })).backlog;
    const createdAt = new Date().toISOString();
    const provider = config.providers?.[0] ?? "markdown";
    if (provider !== "markdown" && provider !== "github") throw new BacklogError("invalid-request", "Suggestions require a project-owned backlog provider");
    const destination = provider === "markdown" ? { provider, path: join(config.dir ?? DEFAULT_BACKLOG_DIRECTORY, `${suggestionItemId(input.title, createdAt)}.md`) } as const
      : { provider, repo: config.github?.repo ?? await this.deps.githubRepo(repo), label: "agent-filed" } as const;
    const { sessionTitle, ...currentModel } = session;
    const defaultModel: BacklogSuggestionModel = { ...currentModel, ...settings.suggestionsDefault, ...config.suggestions };
    const record: BacklogSuggestion = { id: randomUUID(), sessionId, projectId: project.id, ...(sessionTitle === undefined ? {} : { sessionTitle }), title: input.title, body: input.body,
      context: { why: input.why, files: input.files, decisions: input.decisions }, destination,
      ...(Object.values(settings.sources).some(source => source.destinationProjectId === projectId) ? { azureReadOnlyNote: true } : {}),
      defaultModel, createdAt, revision: 1, state: { kind: "open" } };
    validateContent(record);
    return this.deps.store.create(record);
  }
  file(id: string, action: BacklogSuggestionAction, input: BacklogSuggestionFileRequest & BacklogSuggestionModel): Promise<BacklogSuggestion> {
    // A suggestion has one owner at a time. Concurrent retries read its durable receipt after completion.
    const previous = this.pending.get(id) ?? Promise.resolve(undefined);
    const result = previous.catch(() => undefined).then(() => this.fileOnce(id, action, input));
    this.pending.set(id, result);
    void result.finally(() => { if (this.pending.get(id) === result) this.pending.delete(id); }).catch(() => undefined);
    return result;
  }
  async transition(id: string, action: "dismiss" | "restore"): Promise<BacklogSuggestion> {
    const record = this.deps.store.require(id);
    if (this.pending.has(id)) throw new BacklogError("conflict", "Wait for filing to finish");
    if (action === "restore") {
      if (record.state.kind !== "dismissed") throw new BacklogError("conflict", "Only dismissed suggestions can be restored");
      return this.deps.store.update({ ...record, state: record.state.restoreTo });
    }
    if (record.state.kind !== "open" && record.state.kind !== "duplicate" && record.state.kind !== "failed") throw new BacklogError("conflict", "This suggestion cannot be dismissed");
    return this.deps.store.update({ ...record, state: { kind: "dismissed", at: new Date().toISOString(), restoreTo: record.state } });
  }
  private async fileOnce(id: string, action: BacklogSuggestionAction, input: BacklogSuggestionActRequest): Promise<BacklogSuggestion> {
    const fingerprint = createHash("sha256").update(JSON.stringify([input.requestId, input.title ?? null, input.body ?? null, [...input.notDuplicateOf ?? []].sort((a, b) => a - b), [...input.acknowledgedPaths ?? []].sort(), input.modelSpec ?? null, input.thinkingLevel ?? null])).digest("hex");
    const receipt = this.deps.store.receipt(id, input.requestId);
    if (receipt !== undefined) {
      if (receipt.fingerprint !== fingerprint || (receipt.action !== undefined && receipt.action !== action)) throw new BacklogError("conflict", "requestId was reused with different filing choices");
      if (receipt.result !== undefined) return receipt.result;
      throw new BacklogError("conflict", "This request was interrupted. Inspect the destination before retrying.");
    }
    let record = this.deps.store.require(id);
    const launchChoice = action !== "file-and-act" ? undefined : record.state.kind === "filed" && record.state.launchChoice !== undefined ? record.state.launchChoice : resolveLaunchChoice(record.defaultModel, input);
    const launchingFiled = action === "file-and-act" && record.state.kind === "filed";
    if (!launchingFiled && record.state.kind !== "open" && record.state.kind !== "duplicate" && !(record.state.kind === "failed" && record.state.retryable)) throw new BacklogError("conflict", "Suggestion is not open for filing");
    if (launchingFiled && (input.title !== undefined || input.body !== undefined || input.notDuplicateOf !== undefined || input.acknowledgedPaths !== undefined)) throw new BacklogError("conflict", "Filed items cannot be edited");
    if (!launchingFiled) validateContent({ ...record, title: input.title ?? record.title, body: input.body ?? record.body });
    const request = { suggestionId: id, requestId: input.requestId, fingerprint, action, input };
    const finish = (next: BacklogSuggestion) => this.deps.store.update(next, { ...request, result: next });
    const project = await this.deps.projects.requireProject(record.projectId);
    if (launchingFiled && record.state.kind === "filed") record = { ...record, state: { ...record.state, ...(launchChoice === undefined ? {} : { launchChoice }) } };
    record = await this.deps.store.update({ ...record, ...(!launchingFiled ? { title: input.title ?? record.title, body: input.body ?? record.body, state: { kind: "filing" as const, action, ...(launchChoice === undefined ? {} : { launchChoice }) } } : {}) }, request);
    if (!launchingFiled) {
      try {
        if (record.destination.provider === "markdown") {
          const state = await writeMarkdownSuggestion(this.deps.worktrees, project, record, { acknowledgedPaths: input.acknowledgedPaths ?? [], onPath: async path => {
            record = await this.deps.store.update({ ...record, destination: { provider: "markdown", path } });
          } });
          record = await this.deps.store.update({ ...record, state: state.kind === "filed" && launchChoice !== undefined ? { ...state, launchChoice } : state });
        } else {
          const result = await this.deps.fileIssue(project.path, record.sessionId, { title: record.title, body: suggestionBody(record), duplicates: [record.title], labels: ["agent-filed"], ...(input.notDuplicateOf === undefined ? {} : { notDuplicateOf: input.notDuplicateOf }) }, record.destination.repo);
          record = await this.deps.store.update({ ...record, state: result.state === "duplicate" ? { kind: "duplicate", matches: result.matches } : { kind: "filed", provider: "github", number: result.number, url: result.url, ...(result.decisionLogWarning === undefined ? {} : { decisionLogWarning: result.decisionLogWarning }), ...(launchChoice === undefined ? {} : { launchChoice }), at: new Date().toISOString() } });
        }
      } catch (error) {
        // An external writer may have accepted a request before the connection failed. Fail closed.
        return finish({ ...record, state: { kind: "failed", action, message: error instanceof Error ? error.message : String(error), retryable: record.destination.provider === "markdown" } });
      }
    }
    if (action === "file-and-act" && record.state.kind === "filed") record = await this.launchFiled(record, input);
    return finish(record);
  }
  private async launchFiled(record: BacklogSuggestion, input: BacklogSuggestionActRequest): Promise<BacklogSuggestion> {
    if (record.state.kind !== "filed") throw new BacklogError("conflict", "Only a filed item can launch");
    let filed = record.state;
    const model = filed.launchChoice ?? resolveLaunchChoice(record.defaultModel, input);
    if (filed.launchChoice === undefined) {
      filed = { ...filed, launchChoice: model };
      record = await this.deps.store.update({ ...record, state: filed });
    }
    try {
      const project = await this.deps.projects.requireProject(record.projectId);
      const itemId = filed.provider === "markdown" ? record.destination.provider === "markdown" ? record.destination.path.split("/").at(-1)?.slice(0, -3) : undefined : String(filed.number);
      if (itemId === undefined) throw new Error("Filed item identity is missing");
      const launched = await this.deps.backlog.launchInBackground(project.id, itemId, { requestId: `suggestion-${record.id}`, start: { cwd: project.path, ...model, destination: { kind: "fresh-worktree" } } }, filed.provider, "everyone", record.destination.provider === "markdown" ? { providers: ["markdown"], dir: dirname(record.destination.path) } : { providers: ["github"], github: { repo: record.destination.repo } });
      const state = { ...filed }; delete state.launchError; delete state.launchChoice;
      record = await this.deps.store.update({ ...record, state: { ...state, kind: "started", sessionId: launched.session.id, claimId: launched.claim.claimId, ...model } });
    } catch (error) { record = await this.deps.store.update({ ...record, state: { ...filed, launchError: { message: error instanceof Error ? error.message : String(error), retryable: true } } }); }
    return record;
  }
}

function validateContent(record: BacklogSuggestion): void {
  const limit = record.destination.provider === "markdown" ? 255 * 1024 : 64000;
  if (Buffer.byteLength(suggestionBody(record), "utf8") > limit) throw new BacklogError("invalid-request", `Suggestion with context exceeds the ${record.destination.provider} item limit. Shorten the body or context.`);
}

function resolveLaunchChoice(defaultModel: BacklogSuggestionModel, input: BacklogSuggestionModel): BacklogSuggestionModel {
  return { ...defaultModel, ...(input.modelSpec === undefined ? {} : { modelSpec: input.modelSpec }), ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }) };
}
