import { Type, type Static } from "typebox";
import { BacklogAzureDevopsConfigSchema } from "./backlog.js";
export const BacklogSourceCreateSchema = Type.Object({
  ...BacklogAzureDevopsConfigSchema.properties,
  destinationProjectId: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
}, { additionalProperties: false });
export type BacklogSourceInput = Static<typeof BacklogSourceCreateSchema>;
export const BacklogSourceSchema = Type.Object({
  ...BacklogSourceCreateSchema.properties,
  id: Type.String({ format: "uuid" }), provider: Type.Literal("azure-devops"),
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), updatedAt: Type.String(),
}, { additionalProperties: false });
export type BacklogSource = Static<typeof BacklogSourceSchema>;
export const BacklogSourceSaveSchema = Type.Object({
  ...BacklogSourceCreateSchema.properties, baseRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export const BacklogSourceDeleteSchema = Type.Object({ baseRevision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const BacklogSourceSettingsSchema = Type.Object({ ...BacklogSourceSchema.properties, warnings: Type.Array(Type.String()) });
export type BacklogSourceSettings = Static<typeof BacklogSourceSettingsSchema>;

/** UNDER means a segment ancestor, never a string prefix. */
export function azureSourcesOverlap(a: BacklogSourceInput, b: BacklogSourceInput): boolean {
  if (a.organization.toLowerCase() !== b.organization.toLowerCase() || a.project.toLowerCase() !== b.project.toLowerCase()) return false;
  if (a.areaPath === undefined || b.areaPath === undefined) return true;
  const left = a.areaPath.toLowerCase().split("\\"); const right = b.areaPath.toLowerCase().split("\\");
  return left.slice(0, Math.min(left.length, right.length)).every((segment, index) => segment === right[index]);
}
export function sourceOverlapMessage(source: BacklogSourceInput): string {
  return `Overlaps ${source.organization} / ${source.project} (${source.areaPath ?? "no Area Path"}). Give both sources Area Paths that do not overlap.`;
}
export function sourceWarnings(source: BacklogSource, sources: readonly BacklogSource[]): string[] {
  return sources.filter((other) => other.id !== source.id && azureSourcesOverlap(source, other)).map(sourceOverlapMessage);
}
