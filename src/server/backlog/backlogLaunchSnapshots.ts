import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Check } from "typebox/value";
import { BacklogLaunchContentSchema, type BacklogLaunchContent } from "../../shared/backlog.js";
import { isMissingFile } from "./backlogError.js";

/** One private snapshot per claim. Persistent stores never cache image payloads. */
export class BacklogLaunchSnapshots {
  private readonly memory = new Map<string, BacklogLaunchContent>();
  constructor(private readonly directory?: string) {}

  async initialize(claimIds: readonly string[]): Promise<void> {
    if (this.directory === undefined) return;
    const kept = new Set(claimIds.map((id) => this.filename(id)));
    let entries;
    try { entries = await readdir(this.directory, { withFileTypes: true }); }
    catch (error) { if (isMissingFile(error)) return; throw error; }
    await chmod(this.directory, 0o700);
    for (const entry of entries) {
      if ((entry.isFile() || entry.isSymbolicLink()) && (entry.name.endsWith(".tmp") || entry.name.endsWith(".json") && !kept.has(entry.name))) {
        await unlink(join(this.directory, entry.name));
      }
    }
  }

  async read(claimId: string): Promise<BacklogLaunchContent | undefined> {
    if (this.directory === undefined) return structuredClone(this.memory.get(claimId));
    let text: string;
    try { text = await readFile(join(this.directory, this.filename(claimId)), "utf8"); }
    catch (error) { if (isMissingFile(error)) return undefined; throw error; }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("Invalid backlog launch snapshot"); }
    if (!Check(BacklogLaunchContentSchema, value)) throw new Error("Invalid backlog launch snapshot");
    return value;
  }

  async write(claimId: string, content: BacklogLaunchContent): Promise<void> {
    if (!Check(BacklogLaunchContentSchema, content)) throw new Error("Invalid backlog launch snapshot");
    if (this.directory === undefined) { this.memory.set(claimId, structuredClone(content)); return; }
    const target = join(this.directory, this.filename(claimId));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = join(this.directory, `${claimId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(content)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, target);
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }

  async remove(claimIds: readonly string[]): Promise<void> {
    for (const claimId of claimIds) {
      if (this.directory === undefined) { this.memory.delete(claimId); continue; }
      try { await unlink(join(this.directory, this.filename(claimId))); }
      catch (error) { if (!isMissingFile(error)) throw error; }
    }
  }

  private filename(claimId: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(claimId)) throw new Error("Invalid backlog launch snapshot identity");
    return `${claimId}.json`;
  }
}
