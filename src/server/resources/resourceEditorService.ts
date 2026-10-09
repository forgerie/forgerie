import { lock } from "proper-lockfile";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ResourceEditorEntry, ResourceEditorFile, ResourceEditorInventory, ResourceEditorSave, ResourceEditorSaveRequest, ResourceEditorScope } from "../../shared/resourceEditor.js";
import { RESOURCE_EDITOR_MAX_BYTES } from "../../shared/resourceEditor.js";
import { ResourceEditorDiscovery, type DiscoveredEditorResource, type EditorDiscoveryOptions } from "./resourceEditorDiscovery.js";
import { insideResourceRoot, isMissingResource, readResourceFile, ResourceEditorError, writableResourcePath, writeResourceFile } from "./resourceEditorFiles.js";
import { commitResource, prepareResourceCommit, resourceCheckout, resourceLockPath, type ResourceCheckout } from "./resourceEditorGit.js";

export interface ResourceEditorSession { cwd: string; readOnlyReason?: string }
export interface ResourceEditorOptions extends EditorDiscoveryOptions {
  session: (sessionId: string) => Promise<ResourceEditorSession>;
}
interface EditorContext { scope: ResourceEditorScope; readOnlyReason?: string; checkout?: ResourceCheckout }

export class ResourceEditorService {
  private readonly discovery: ResourceEditorDiscovery;
  private activeReads = 0;
  constructor(private readonly options: ResourceEditorOptions) { this.discovery = new ResourceEditorDiscovery(options); }

  async inventory(sessionId?: string): Promise<ResourceEditorInventory> {
    return this.bounded(async () => {
      const context = await this.context(sessionId);
      const found = await this.discovery.discover(context.scope);
      return { scope: context.scope, basis: "configured-files-on-disk", resources: await Promise.all(found.resources.map((resource) => this.entry(resource, context))), diagnostics: found.diagnostics, maxFileBytes: RESOURCE_EDITOR_MAX_BYTES };
    });
  }

  async read(id: string, sessionId?: string): Promise<ResourceEditorFile> {
    return this.bounded(async () => {
      const context = await this.context(sessionId);
      const resource = await this.find(id, context);
      const content = await readResourceFile(resource.entry.path);
      return { resource: await this.entry(resource, context), text: content.text, revision: content.revision };
    });
  }

  async save(id: string, input: ResourceEditorSaveRequest, sessionId?: string): Promise<ResourceEditorSave> {
    if (Buffer.byteLength(input.text, "utf8") > RESOURCE_EDITOR_MAX_BYTES) throw new ResourceEditorError("over-limit", "Resource files are limited to 1 MiB.");
    return this.bounded(async () => {
      const context = await this.context(sessionId);
      const resource = await this.find(id, context);
      const entry = await this.entry(resource, context);
      if (entry.edit.kind !== "writable") throw new ResourceEditorError("read-only", entry.edit.reason);
      const canonicalPath = await writableResourcePath(entry.path, resource.writeRoot);
      return withFileMutationQueue(canonicalPath, async () => {
        const projectCheckout = entry.origin.kind === "project" ? context.checkout : undefined;
        const lockTarget = projectCheckout?.gitDir ?? resource.writeRoot;
        let release: () => Promise<void>;
        let compromised: Error | undefined;
        try { release = await lock(lockTarget, { lockfilePath: resourceLockPath(canonicalPath, projectCheckout), retries: 0, onCompromised: (error) => { compromised = error; } }); }
        catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ELOCKED") throw new ResourceEditorError("busy", "Another resource save is in progress. Retry after it finishes.");
          throw error;
        }
        let written = false;
        try {
          // Re-resolve the session and inventory after waiting for another writer.
          const currentContext = await this.context(sessionId);
          const currentResource = await this.find(id, currentContext);
          const currentEntry = await this.entry(currentResource, currentContext);
          if (currentEntry.edit.kind !== "writable") throw new ResourceEditorError("read-only", currentEntry.edit.reason);
          if (currentContext.scope.kind === "session" && context.scope.kind === "session" && currentContext.scope.cwd !== context.scope.cwd) throw new ResourceEditorError("conflict", "The session's checkout changed. Read the inventory again.");
          const current = await readResourceFile(currentEntry.path);
          if (current.revision !== input.baseRevision) throw new ResourceEditorError("conflict", "This file changed on disk. Read it again before saving.");
          if (current.text === input.text) return { file: { resource: currentEntry, text: current.text, revision: current.revision }, effect: { kind: "unchanged" }, reload: "explicit-session-reload" };
          const commitBase = currentEntry.edit.saveEffect === "commit" && currentContext.checkout !== undefined ? await prepareResourceCommit(currentContext.checkout, current.canonicalPath) : undefined;
          if (compromised !== undefined) throw new ResourceEditorError("busy", "The resource lock changed. Retry after other writers finish.");
          await writeResourceFile(currentEntry.path, currentResource.writeRoot, current, input.text);
          written = true;
          const commit = commitBase === undefined || currentContext.checkout === undefined ? undefined : await commitResource(currentContext.checkout, commitBase);
          const after = await readResourceFile(currentEntry.path);
          const refreshed = await this.find(id, currentContext);
          return { file: { resource: await this.entry(refreshed, currentContext), text: after.text, revision: after.revision },
            effect: commit === undefined ? { kind: currentEntry.edit.saveEffect === "uncommitted" ? "uncommitted" : "file-only" } : { kind: "committed", ...commit }, reload: "explicit-session-reload" };
        } catch (error) {
          if (written && !(error instanceof ResourceEditorError && error.savedToDisk)) throw new ResourceEditorError("io-error", `The file was saved, but verification failed: ${error instanceof Error ? error.message : String(error)}`, true);
          throw error;
        } finally {
          await release().catch((error: unknown) => { throw new ResourceEditorError("io-error", `Could not release the resource lock: ${error instanceof Error ? error.message : String(error)}`, written); });
        }
      });
    });
  }

  private async context(sessionId?: string): Promise<EditorContext> {
    if (sessionId === undefined) return { scope: { kind: "settings" } };
    const session = await this.options.session(sessionId);
    return { scope: { kind: "session", sessionId, cwd: session.cwd }, ...(session.readOnlyReason === undefined ? {} : { readOnlyReason: session.readOnlyReason }), checkout: await resourceCheckout(session.cwd) };
  }

  private async find(id: string, context: EditorContext): Promise<DiscoveredEditorResource> {
    const resource = (await this.discovery.discover(context.scope)).resources.find((candidate) => candidate.entry.id === id);
    if (resource === undefined) throw new ResourceEditorError("not-found", "This resource is not in this inventory. Read the inventory again.");
    return resource;
  }

  private async entry(resource: DiscoveredEditorResource, context: EditorContext): Promise<ResourceEditorEntry> {
    const origin = resource.entry.origin.kind;
    const readonly = (reason: string): ResourceEditorEntry => ({ ...resource.entry, edit: { kind: "read-only", reason } });
    if (origin === "package" || origin === "bundled") return readonly("A package update replaces this file. Package and bundled resources are read-only.");
    if (context.readOnlyReason !== undefined) return readonly(context.readOnlyReason);
    let canonicalPath: string;
    try { canonicalPath = await writableResourcePath(resource.entry.path, resource.writeRoot); }
    catch (error) { return readonly(error instanceof Error ? error.message : String(error)); }
    if (origin !== "project") return { ...resource.entry, edit: { kind: "writable", saveEffect: "file-only" } };
    const checkout = context.checkout;
    if (checkout === undefined || !insideResourceRoot(canonicalPath, checkout.root)) return readonly("Inherited project files outside this checkout are read-only. Open a session in their checkout to edit them.");
    return { ...resource.entry, edit: { kind: "writable", saveEffect: checkout.kind === "main" ? "commit" : "uncommitted" } };
  }

  private async bounded<T>(run: () => Promise<T>): Promise<T> {
    if (this.activeReads >= 4) throw new ResourceEditorError("busy", "Resource loading is busy. Retry after an active request finishes.");
    this.activeReads++;
    try { return await run(); }
    catch (error) {
      if (error instanceof ResourceEditorError) throw error;
      if (isMissingResource(error)) throw new ResourceEditorError("not-found", "The resource file or folder no longer exists.");
      throw new ResourceEditorError("io-error", error instanceof Error ? error.message : String(error));
    } finally { this.activeReads--; }
  }
}
