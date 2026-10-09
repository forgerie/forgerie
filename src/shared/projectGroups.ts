import { Type, type Static } from "typebox";

const id = Type.String({ minLength: 1, maxLength: 256 });
export const ProjectGroupInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  projectIds: Type.Array(id, { uniqueItems: true, maxItems: 100 }),
}, { additionalProperties: false });
export const ProjectGroupSchema = Type.Object({
  id, name: Type.String(), projectIds: Type.Array(id), revision: Type.Integer({ minimum: 1 }),
  createdAt: Type.String(), updatedAt: Type.String(),
}, { additionalProperties: false });
export const ProjectGroupUpdateSchema = Type.Object({ ...ProjectGroupInputSchema.properties, revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const RelatedSessionSchema = Type.Object({ id, cwd: Type.String({ minLength: 1 }), projectId: id }, { additionalProperties: false });
export type ProjectGroup = Static<typeof ProjectGroupSchema>;
export type ProjectGroupInput = Static<typeof ProjectGroupInputSchema>;
export type RelatedSession = Static<typeof RelatedSessionSchema>;
