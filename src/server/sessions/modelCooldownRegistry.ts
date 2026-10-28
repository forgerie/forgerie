import { childModelDiagnostic } from "../../shared/childModelDiagnostic.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { ModelCooldowns } from "../../shared/modelChains.js";

const schema = Type.Record(Type.String(), Type.Object({ until: Type.Number({ minimum: 0 }), reason: Type.String() }));
/** One daemon owns this file and shares this instance across all its sessions. Memory follows atomic writes. */
export class ModelCooldownRegistry {
  private values: ModelCooldowns | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly onError: (error: unknown) => void) {}
  snapshot(): Promise<ModelCooldowns> { return this.exclusive(async () => structuredClone(await this.load())); }
  mark(model: string, until: number, reason: string): Promise<void> {
    return this.exclusive(async () => {
      const previous = await this.load();
      if ((previous[model]?.until ?? 0) >= until) return;
      const values = { ...previous, [model]: { until, reason: childModelDiagnostic(reason) } };
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify(values)}\n`, { mode: 0o600 }); await rename(temporary, this.path); }
      finally { await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; }); }
      this.values = values;
    });
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation); this.queue = pending.catch(() => undefined); return pending;
  }
  private async load(): Promise<ModelCooldowns> {
    if (this.values !== undefined) return this.values;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!Check(schema, parsed)) throw new Error("Invalid model cooldown registry");
      this.values = Object.fromEntries(Object.entries(parsed).map(([model, value]) => [model, { ...value, reason: childModelDiagnostic(value.reason) }]));
    } catch (error) {
      if (!missing(error)) this.onError(error);
      this.values = {};
    }
    return this.values;
  }
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
