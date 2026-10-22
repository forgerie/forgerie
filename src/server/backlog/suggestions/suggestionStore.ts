import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { BacklogSuggestionActRequestSchema, BacklogSuggestionSchema, type BacklogSuggestion } from "../../../shared/backlogSuggestions.js";
import { BacklogError, isMissingFile } from "../backlogError.js";

const ReceiptSchema = Type.Object({ suggestionId: Type.String(), requestId: Type.String(), fingerprint: Type.String(), action: Type.Optional(Type.Union([Type.Literal("file"), Type.Literal("file-and-act")])), input: Type.Optional(BacklogSuggestionActRequestSchema), result: Type.Optional(BacklogSuggestionSchema) }, { additionalProperties: false });
type Receipt = Static<typeof ReceiptSchema>;
const FileSchema = Type.Object({ version: Type.Literal(1), suggestions: Type.Array(BacklogSuggestionSchema), requests: Type.Array(ReceiptSchema) }, { additionalProperties: false });
type File = Static<typeof FileSchema>;

/** Single sessiond owner. Receipts and records share one atomic replacement. */
export class BacklogSuggestionStore {
  private file: File = { version: 1, suggestions: [], requests: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly changed: (record: BacklogSuggestion) => void = () => undefined) {}
  async initialize(): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); } catch (error) { if (isMissingFile(error)) return; throw error; }
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog suggestions file; it has not been overwritten");
    if (new Set(value.suggestions.map(record => record.id)).size !== value.suggestions.length) throw new Error("Duplicate backlog suggestion IDs");
    this.file = value;
    // GitHub writes cannot be proved locally. Markdown recovery verifies Git before changing these records.
    for (const record of value.suggestions.filter(record => record.state.kind === "filing" && record.destination.provider === "github")) {
      await this.update({ ...record, state: { kind: "failed", message: "Filing was interrupted. Inspect the destination before dismissing and suggesting again.", retryable: false } });
    }
  }
  list(): BacklogSuggestion[] { return structuredClone(this.file.suggestions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  require(id: string): BacklogSuggestion {
    const record = this.file.suggestions.find(record => record.id === id);
    if (record === undefined) throw new BacklogError("not-found", "Backlog suggestion not found");
    return structuredClone(record);
  }
  receipt(suggestionId: string, requestId: string): Receipt | undefined { return structuredClone(this.file.requests.find(receipt => receipt.suggestionId === suggestionId && receipt.requestId === requestId)); }
  pendingReceipt(suggestionId: string): Receipt | undefined { return structuredClone(this.file.requests.filter(receipt => receipt.suggestionId === suggestionId && receipt.result === undefined).at(-1)); }
  create(record: BacklogSuggestion): Promise<BacklogSuggestion> { return this.mutate(file => {
    if (file.suggestions.some(value => value.id === record.id)) throw new BacklogError("conflict", "Suggestion already exists");
    file.suggestions.push(record); return record;
  }); }
  update(record: BacklogSuggestion, receipt?: Receipt): Promise<BacklogSuggestion> { return this.mutate(file => {
    const index = file.suggestions.findIndex(value => value.id === record.id);
    if (index < 0) throw new BacklogError("not-found", "Suggestion not found");
    if (file.suggestions[index]?.revision !== record.revision) throw new BacklogError("conflict", "Suggestion changed; reload before trying again");
    const next = { ...record, revision: record.revision + 1 };
    file.suggestions[index] = next;
    if (receipt !== undefined) {
      file.requests = file.requests.filter(value => value.suggestionId !== receipt.suggestionId || value.requestId !== receipt.requestId);
      file.requests.push({ ...receipt, ...(receipt.result === undefined ? {} : { result: next }) });
    }
    return next;
  }); }
  private mutate(action: (file: File) => BacklogSuggestion): Promise<BacklogSuggestion> {
    const result = this.queue.then(async () => {
      const file = structuredClone(this.file); const record = action(file);
      if (!Check(FileSchema, file)) throw new Error("Invalid backlog suggestions mutation");
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, JSON.stringify(file), { mode: 0o600 }); await rename(temp, this.path); }
      finally { await unlink(temp).catch((error: unknown) => { if (!isMissingFile(error)) throw error; }); }
      this.file = file; this.changed(structuredClone(record)); return structuredClone(record);
    });
    this.queue = result.catch(() => undefined); return result;
  }
}
