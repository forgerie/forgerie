import { Type, type Static } from "typebox";
import { KNOWN_THINKING_LEVELS } from "./thinkingLevels.js";
import { WEEKDAYS } from "./triggerSchedules.js";
import { WorkflowDefinitionSchema, WorkflowInputsSchema } from "./workflowRuns.js";

/**
 * The contract for schedules that live in workflow files (ADR 0009).
 *
 * A global workflow file (`<agentDir>/prompts/<name>.md`) may add a `schedule:` block to its front matter. That file
 * is then a trigger whose ID is `<name>`. The user writes the block; Forgerie keeps run history, attention and fire
 * receipts in its own store, keyed by the same ID. A `schedule:` block in a project's `.pi/prompts` copy is ignored
 * and reported as a warning.
 */

export const TRIGGER_MODEL_MAX_LENGTH = 128;
const MAX_MODEL_REFERENCE_LENGTH = TRIGGER_MODEL_MAX_LENGTH + 1 + Math.max(...KNOWN_THINKING_LEVELS.map((level) => level.length));

const LocalTimeSchema = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" });
const WeekdaySchema = Type.Union([
  Type.Literal(WEEKDAYS[0]), Type.Literal(WEEKDAYS[1]), Type.Literal(WEEKDAYS[2]),
  Type.Literal(WEEKDAYS[3]), Type.Literal(WEEKDAYS[4]), Type.Literal(WEEKDAYS[5]), Type.Literal(WEEKDAYS[6]),
]);

/** The `schedule:` block, exactly as the file holds it. Unknown keys are an error. */
export const WorkflowScheduleBlockSchema = Type.Object({
  /** Shown on the Triggers page and in session names. Default: the file name. */
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  /** Local time, "HH:mm". */
  at: LocalTimeSchema,
  /** Omitted: every day. */
  days: Type.Optional(Type.Array(WeekdaySchema, { minItems: 1, maxItems: 7, uniqueItems: true })),
  /** IANA zone. Omitted: the daemon host's zone. */
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  /** How late a missed run may still start: "0", or a number with m, h or d, at most 7 days. Omitted: 6h. */
  late: Type.Optional(Type.String({ pattern: "^(0|[1-9][0-9]*[mhd])$" })),
  /** Registered project names, absolute workspace paths, or "all". */
  projects: Type.Union([Type.Literal("all"), Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })]),
  /** The coordinator's model, `provider/model-id`, optionally `:thinking-level`. Omitted: new-session default. */
  model: Type.Optional(Type.String({ minLength: 3, maxLength: MAX_MODEL_REFERENCE_LENGTH, pattern: `^(?=.{3,${String(TRIGGER_MODEL_MAX_LENGTH)}}(?::(?:${KNOWN_THINKING_LEVELS.join("|")}))?$)[^/\\s]+/\\S+$` })),
  /** True stops future runs without removing the schedule. */
  paused: Type.Optional(Type.Boolean()),
  /** Values that replace the workflow's input defaults for scheduled runs only. */
  inputs: Type.Optional(WorkflowInputsSchema),
}, { additionalProperties: false });
export type WorkflowScheduleBlock = Static<typeof WorkflowScheduleBlockSchema>;

/** Where a trigger's settings come from, added to every Trigger the server returns. Not stored. */
export const TriggerFileStateSchema = Type.Object({
  /** Absolute path of the global workflow file. */
  path: Type.String(),
  /**
   * ok: the file's schedule is the one that runs.
   * invalid: the file cannot be read as a schedule; the last good settings keep running.
   * missing: the file or its schedule block is gone; the trigger is paused and keeps its history.
   */
  status: Type.Union([Type.Literal("ok"), Type.Literal("invalid"), Type.Literal("missing")]),
  /** Set when status is invalid. `line` is 1-based in the file, when known. */
  problem: Type.Optional(Type.Object({ message: Type.String(), line: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false })),
  /** When the settings that run now were last read from a valid file. Unix milliseconds. */
  lastGoodAt: Type.Optional(Type.Number()),
}, { additionalProperties: false });
export type TriggerFileState = Static<typeof TriggerFileStateSchema>;

/** GET /triggers/:id/file. The whole file plus what the server read from it. */
export const TriggerFileDocumentSchema = Type.Object({
  path: Type.String(),
  text: Type.String(),
  /** Hash of `text`. Send it back as `baseSha256` to save. */
  sha256: Type.String(),
  modifiedAt: Type.Number(),
  /** The parsed `schedule:` block, or null when it is absent or invalid. */
  schedule: Type.Union([WorkflowScheduleBlockSchema, Type.Null()]),
  /** The parsed `workflow:` block, or null when it is invalid. */
  definition: Type.Union([WorkflowDefinitionSchema, Type.Null()]),
  /** The markdown after the front matter. */
  body: Type.String(),
}, { additionalProperties: false });
export type TriggerFileDocument = Static<typeof TriggerFileDocumentSchema>;

/**
 * PUT /triggers/:id/file. `text` is the whole file as the editor holds it. With `schedule`, the server replaces the
 * file's `schedule:` block with it before saving, keeping other front matter, key order and comments. The server
 * validates the result as a workflow and a schedule and refuses it (400, with `line` when known) rather than save a
 * file that would not run. A `baseSha256` that no longer matches the file is refused with 409.
 * Success returns `{trigger, document}`; `TriggerFileSavedSchema` is in `triggers.ts` to avoid a schema import cycle.
 */
export const TriggerFileSaveRequestSchema = Type.Object({
  text: Type.String({ maxLength: 512 * 1024 }),
  baseSha256: Type.String({ minLength: 64, maxLength: 64 }),
  schedule: Type.Optional(WorkflowScheduleBlockSchema),
}, { additionalProperties: false });
export type TriggerFileSaveRequest = Static<typeof TriggerFileSaveRequestSchema>;

export const TriggerFileVersionSchema = Type.Object({
  id: Type.String({ pattern: "^[a-zA-Z0-9-]{1,80}$" }),
  savedAt: Type.Number(),
  /** forgerie: saved through Forgerie. outside: a change Forgerie found on disk. migration: written by the upgrade. */
  source: Type.Union([Type.Literal("forgerie"), Type.Literal("outside"), Type.Literal("migration")]),
  sha256: Type.String(),
}, { additionalProperties: false });
export type TriggerFileVersion = Static<typeof TriggerFileVersionSchema>;

/** GET /triggers/:id/versions. Newest first, at most TRIGGER_FILE_VERSION_LIMIT. */
export const TriggerFileVersionsResponseSchema = Type.Object({ versions: Type.Array(TriggerFileVersionSchema) }, { additionalProperties: false });
export type TriggerFileVersionsResponse = Static<typeof TriggerFileVersionsResponseSchema>;

/** GET /triggers/:id/versions/:versionId. Restore is a normal PUT of this text. */
export const TriggerFileVersionTextSchema = Type.Object({ ...TriggerFileVersionSchema.properties, text: Type.String() }, { additionalProperties: false });
export type TriggerFileVersionText = Static<typeof TriggerFileVersionTextSchema>;

export const TRIGGER_FILE_VERSION_LIMIT = 30;
export const DEFAULT_LATE = "6h";
export const MAX_LATE_MINUTES = 10_080;

/** "0", "45m", "6h" or "1d" as minutes. Undefined when the text is not one of these forms. */
export function lateMinutes(late: string): number | undefined {
  const match = /^(0|([1-9][0-9]*)([mhd]))$/u.exec(late);
  if (match === null) return undefined;
  if (match[1] === "0") return 0;
  const minutes = Number(match[2]) * (match[3] === "m" ? 1 : match[3] === "h" ? 60 : 1_440);
  return minutes <= MAX_LATE_MINUTES ? minutes : undefined;
}

/** Minutes as the shortest `late` text: 360 is "6h", 90 is "90m". */
export function lateText(minutes: number): string {
  if (minutes === 0) return "0";
  if (minutes % 1_440 === 0) return `${String(minutes / 1_440)}d`;
  if (minutes % 60 === 0) return `${String(minutes / 60)}h`;
  return `${String(minutes)}m`;
}
