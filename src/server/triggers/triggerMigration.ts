import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { JsonObject } from "@earendil-works/pi-durable";
import { TriggerActionSchema, TriggerFireSchema, TriggerSchema, type TriggerAction, type TriggerFire } from "../../shared/triggers.js";

export const LegacyTriggerActionSchema = Type.Object({
  kind: TriggerActionSchema.properties.kind, cwd: Type.String({ minLength: 1 }),
  workflow: TriggerActionSchema.properties.workflow, inputs: TriggerActionSchema.properties.inputs,
  model: TriggerActionSchema.properties.model, thinkingLevel: TriggerActionSchema.properties.thinkingLevel,
}, { additionalProperties: false });
const LegacyFireSchema = Type.Object({ ...TriggerFireSchema.properties, projects: Type.Optional(TriggerFireSchema.properties.projects) }, { additionalProperties: false });
const LegacyTriggerSchema = Type.Object({ ...TriggerSchema.properties, action: LegacyTriggerActionSchema, history: Type.Array(LegacyFireSchema), incarnation: Type.String() }, { additionalProperties: false });
const StoredTriggersSchema = Type.Object({ records: Type.Record(Type.String(), Type.Object({ ...TriggerSchema.properties, incarnation: Type.String() }, { additionalProperties: false })), nextGeneration: Type.Integer(), manualRequests: Type.Record(Type.String(), Type.Object({ triggerId: Type.String(), incarnation: Type.String(), requestId: Type.Optional(Type.String()) })), fileMigration: Type.Optional(Type.Object({ done: Type.Boolean(), pending: Type.Record(Type.String(), Type.String()), migrated: Type.Array(Type.String()), skipped: Type.Array(Type.String()) })) });
export type StoredTriggers = Static<typeof StoredTriggersSchema>;
const LegacyStoreSchema = Type.Object({ ...StoredTriggersSchema.properties, records: Type.Record(Type.String(), LegacyTriggerSchema) });

export function migrateTriggerAction(value: unknown): TriggerAction {
  if (Check(TriggerActionSchema, value)) return value;
  if (!Check(LegacyTriggerActionSchema, value)) throw new Error("Invalid legacy trigger action");
  const { cwd, ...action } = value;
  return { ...action, targets: { kind: "projects", cwds: [cwd] } };
}

/** Keep revisions, incarnations, generations, and manual receipts unchanged. */
export function migrateTriggerStore(value: JsonObject, fromVersion: number): StoredTriggers {
  if (fromVersion !== 1 || !Check(LegacyStoreSchema, value)) throw new Error("Unsupported trigger document migration");
  const records: StoredTriggers["records"] = {};
  for (const [id, record] of Object.entries(value.records)) {
    const history: TriggerFire[] = record.history.map((fire) => {
      const { cwd, ...outcome } = "cwd" in fire.outcome ? fire.outcome : { ...fire.outcome, cwd: undefined };
      return { ...fire, projects: fire.projects ?? [{ cwd: cwd ?? record.action.cwd, outcome }] };
    });
    records[id] = { ...record, action: migrateTriggerAction(record.action), history };
  }
  const migrated = { ...value, records };
  if (!Check(StoredTriggersSchema, migrated)) throw new Error("Invalid migrated trigger document");
  return migrated;
}
