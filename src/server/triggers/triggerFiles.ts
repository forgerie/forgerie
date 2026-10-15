import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Check } from "typebox/value";
import { TriggerIdSchema } from "../../shared/triggers.js";
import { TRIGGER_FILE_VERSION_LIMIT, TriggerFileVersionTextSchema, type TriggerFileDocument, type TriggerFileVersion, type TriggerFileVersionText, type TriggerFileVersionsResponse, type TriggerFileSaveRequest } from "../../shared/triggerFiles.js";
import { parseWorkflow } from "../resources/workflowLibrary.js";
import { isMissingResource, readResourceFile, resourceHash, writeResourceFile, ResourceEditorError } from "../resources/resourceEditorFiles.js";
import { editScheduleBlock, parseScheduledWorkflow } from "./triggerFileFormat.js";
import { TriggerError } from "./durableTriggers.js";

/** File IO and version retention. Callers serialize saves and scans through the service's file queue. */
export class TriggerFiles {
  constructor(readonly directory: string, private readonly versionsDirectory: string, private readonly timezone: string, private readonly now: () => number, private readonly onError: (error: unknown) => void) {}
  path(id: string): string {
    if (!Check(TriggerIdSchema, id)) throw new TriggerError("Invalid trigger file name", 400, "id");
    return join(this.directory, `${id}.md`);
  }
  async names(): Promise<string[]> {
    const files = await readdir(this.directory, { withFileTypes: true }).catch((error: unknown) => { if (isMissingResource(error)) return []; throw error; });
    return files.filter((file) => file.name.endsWith(".md") && (file.isFile() || file.isSymbolicLink())).map((file) => file.name.slice(0, -3));
  }
  /** A watch echo needs only byte hashes, not YAML parsing, versions or durable reads. */
  async hashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    for (const id of await this.names()) {
      if (!Check(TriggerIdSchema, id)) continue;
      try { hashes.set(id, resourceHash((await readResourceFile(this.path(id))).text)); }
      catch (error) { if (!isMissingResource(error)) throw error; }
    }
    return hashes;
  }
  async document(id: string): Promise<TriggerFileDocument> {
    const path = this.path(id);
    try {
      const { text } = await readResourceFile(path);
      let schedule: TriggerFileDocument["schedule"] = null;
      let definition: TriggerFileDocument["definition"] = null;
      let body = text.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/mu, "");
      try { const workflow = parseWorkflow(id, path, text); definition = workflow.definition; body = workflow.body; } catch { /* An invalid file remains readable for repair. */ }
      try { schedule = parseScheduledWorkflow(id, path, text, this.timezone)?.block ?? null; } catch { /* File state reports validation problems; GET returns the actual bytes. */ }
      return { path, text, sha256: resourceHash(text), modifiedAt: (await stat(path)).mtimeMs, schedule, definition, body };
    } catch (error) { if (isMissingResource(error)) throw new TriggerError(`Global workflow file ${path} is missing`, 404); throw error; }
  }
  async save(id: string, request: TriggerFileSaveRequest, validate: (text: string) => Promise<void>, source: TriggerFileVersion["source"] = "forgerie"): Promise<TriggerFileDocument> {
    const path = this.path(id);
    const expected = await readResourceFile(path).catch((error: unknown) => { if (isMissingResource(error)) throw new TriggerError(`Global workflow file ${path} is missing`, 404); throw error; });
    if (resourceHash(expected.text) !== request.baseSha256) throw new TriggerError("This file changed on disk. Read it again before saving.", 409, "baseSha256");
    const text = request.schedule === undefined ? request.text : editScheduleBlock(request.text, request.schedule);
    await validate(text);
    // Retain both sides even when an outside edit arrived before the watcher.
    await this.observe(id, expected.text, "outside");
    try { await writeResourceFile(path, this.directory, expected, text); }
    catch (error) { if (error instanceof ResourceEditorError) throw new TriggerError(error.message, error.kind === "conflict" ? 409 : 400); throw error; }
    await this.observe(id, text, source);
    return this.document(id);
  }
  async observe(id: string, text: string, source: TriggerFileVersion["source"]): Promise<void> {
    const versions = await this.versionList(id);
    const sha256 = resourceHash(text);
    if (versions[0]?.sha256 === sha256) return;
    const savedAt = Math.max(this.now(), (versions[0]?.savedAt ?? -1) + 1);
    const version: TriggerFileVersionText = { id: `${String(savedAt)}-${randomUUID()}`, savedAt, source, sha256, text };
    const directory = join(this.versionsDirectory, id);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${version.id}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(version), "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, join(directory, `${version.id}.json`));
    } finally { await rm(temporary, { force: true }); }
    for (const old of versions.slice(TRIGGER_FILE_VERSION_LIMIT - 1)) await rm(join(directory, `${old.id}.json`));
  }
  async versions(id: string): Promise<TriggerFileVersionsResponse> {
    return { versions: (await this.versionList(id)).slice(0, TRIGGER_FILE_VERSION_LIMIT) };
  }
  private async versionList(id: string): Promise<TriggerFileVersion[]> {
    this.path(id);
    const directory = join(this.versionsDirectory, id);
    const names = await readdir(directory).catch((error: unknown) => { if (isMissingResource(error)) return []; throw error; });
    const versions = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => this.readVersion(id, name.slice(0, -5))));
    return versions.filter((version) => version !== undefined).map((version) => ({ id: version.id, savedAt: version.savedAt, source: version.source, sha256: version.sha256 })).sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
  }
  private async readVersion(id: string, versionId: string): Promise<TriggerFileVersionText | undefined> {
    const path = join(this.versionsDirectory, id, `${versionId}.json`);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!Check(TriggerFileVersionTextSchema, value) || value.id !== versionId || value.sha256 !== resourceHash(value.text)) throw new Error("Invalid trigger file version");
      return value;
    } catch (error) {
      if (!isMissingResource(error)) this.onError(new Error(`Skipping unreadable trigger version ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      return undefined;
    }
  }
  async version(id: string, versionId: string): Promise<TriggerFileVersionText> {
    this.path(id);
    if (!/^[a-zA-Z0-9-]{1,80}$/u.test(versionId)) throw new TriggerError("Invalid version ID", 400);
    const version = await this.readVersion(id, versionId);
    if (version === undefined) throw new TriggerError("File version not found or unreadable", 404);
    return version;
  }
}
