import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import lockfile from "proper-lockfile";

const text = Type.String({ minLength: 1 });
const processOwner = Type.Object({ kind: Type.Literal("process"), pid: Type.Integer({ minimum: 1 }), birth: text, session: Type.Optional(text) });
const unitOwner = Type.Object({ kind: Type.Literal("systemd"), unit: Type.String({ pattern: "^forgerie-services-[a-f0-9-]+\\.service$" }) });
const recordSchema = Type.Object({
  worktreeId: text, cwd: text, directory: text, socket: text, tokenFile: text,
  ports: Type.Record(Type.String(), Type.Integer({ minimum: 1, maximum: 65535 })),
  phase: Type.Union([Type.Literal("stopped"), Type.Literal("launching"), Type.Literal("started")]),
  owner: Type.Optional(Type.Union([processOwner, unitOwner])),
});
export type WorkspaceServicesRecord = Static<typeof recordSchema>;
export type WorkspaceServicesOwner = NonNullable<WorkspaceServicesRecord["owner"]>;

/** One daemon owns the inventory. Releasing its lock never stops workspace services. */
export class WorkspaceServicesStore {
  private release: (() => Promise<void>) | undefined;
  private records: WorkspaceServicesRecord[] = [];
  private writes = Promise.resolve();
  private compromised = false;
  constructor(readonly directory: string) {}
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.release = await lockfile.lock(this.directory, { retries: 0, onCompromised: () => { this.compromised = true; } });
    try {
      const value: unknown = JSON.parse(await readFile(join(this.directory, "instances.json"), "utf8"));
      if (!Check(Type.Array(recordSchema), value)) throw new Error("Invalid workspace services inventory");
      if (new Set(value.map((record) => record.worktreeId)).size !== value.length) throw new Error("Duplicate workspace services identity");
      this.records = value;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) { await this.dispose(); throw error; }
    }
  }
  list(): WorkspaceServicesRecord[] { this.assertOwned(); return structuredClone(this.records); }
  get(id: string): WorkspaceServicesRecord | undefined { return this.list().find((record) => record.worktreeId === id); }
  async put(record: WorkspaceServicesRecord): Promise<void> {
    this.assertOwned();
    const write = this.writes.then(async () => {
      this.assertOwned();
      if (!Check(recordSchema, record)) throw new Error("Invalid workspace services record");
      const next = [...this.records.filter((item) => item.worktreeId !== record.worktreeId), structuredClone(record)];
      const target = join(this.directory, "instances.json");
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        this.assertOwned();
        await rename(temporary, target);
        this.records = next;
      } finally { await rm(temporary, { force: true }); }
    });
    this.writes = write.catch(() => undefined);
    await write;
  }
  async dispose(): Promise<void> { await this.writes; const release = this.release; this.release = undefined; await release?.(); }
  private assertOwned(): void { if (this.release === undefined || this.compromised) throw new Error("Workspace services inventory lock is unavailable"); }
}
