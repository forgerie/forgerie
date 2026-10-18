import { Type, type Static } from "typebox";

export const GatedCategorySchema = Type.Union([
  Type.Literal("force-push"), Type.Literal("push-default"), Type.Literal("destroy-local"), Type.Literal("delete-remote"),
  Type.Literal("github-merge-close"), Type.Literal("publish"), Type.Literal("messages"),
]);
export type GatedCategory = Static<typeof GatedCategorySchema>;
export const gatedCategoryLabels: Record<GatedCategory, string> = {
  "force-push": "Force-push, or push all or unknown branches", "push-default": "Push to the default branch", "destroy-local": "Discard local work",
  "delete-remote": "Delete remote branches, tags or releases", "github-merge-close": "Merge or close on GitHub",
  publish: "Publish packages or releases", messages: "Messages and offers in your name",
};
export const AutonomyPolicySchema = Type.Object({
  version: Type.Literal(1), gated: Type.Object({
    "force-push": Type.Boolean(), "push-default": Type.Boolean(), "destroy-local": Type.Boolean(), "delete-remote": Type.Boolean(),
    "github-merge-close": Type.Boolean(), publish: Type.Boolean(), messages: Type.Boolean(),
  }, { additionalProperties: false }), autoPassStops: Type.Boolean(),
}, { additionalProperties: false });
export type AutonomyPolicy = Static<typeof AutonomyPolicySchema>;
export const defaultAutonomyPolicy: AutonomyPolicy = {
  version: 1, gated: { "force-push": true, "push-default": true, "destroy-local": true, "delete-remote": true, "github-merge-close": true, publish: true, messages: true }, autoPassStops: false,
};
export interface AutonomyPolicySource { read(cwd: string): Promise<AutonomyPolicy> }
export const defaultAutonomyPolicySource: AutonomyPolicySource = { read: () => Promise.resolve(structuredClone(defaultAutonomyPolicy)) };
