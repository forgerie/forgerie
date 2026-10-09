import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ProjectWorkspaces } from "../projects/projectWorkspaces.js";
import type { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";

export interface ProjectToolDeps { work: ProjectWorkspaces; worktrees: SessionWorktrees }
const id = Type.Optional(Type.String({ minLength: 1 }));
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: undefined });
const required = (value: string | undefined, name: string) => { if (value === undefined || value === "") throw new Error(`${name} is required.`); return value; };
export function createProjectTools(cwd: string, deps: ProjectToolDeps) {
  const read = defineTool({
    name: "project_context", label: "Project context",
    description: "Discover this project's groups, related repositories and this chat's secondary worktrees. Read a target's instructions before edits. This never moves the session or starts an agent.",
    promptSnippet: "project_context: related repo discovery and target instructions without changing this chat's cwd",
    parameters: Type.Object({ projectId: id }),
    async execute(_callId, params, _signal, _onUpdate, ctx) {
      const ref = { id: ctx.sessionManager.getSessionId(), cwd };
      return result(params.projectId === undefined ? await deps.work.catalog(ref) : await deps.work.context(ref, params.projectId));
    },
  });
  const worktree = defineTool({
    name: "project_worktree", label: "Related worktree", exposure: MODEL_ONLY_EXPOSURE, executionMode: "sequential",
    description: "Prepare, inspect, land or discard a secondary repo worktree owned by this same chat. No other session or agent starts. Land rebases and fast-forwards only that repo. Discard requires the exact preview token and explicit user approval. Nothing is merged or deleted automatically.",
    promptSnippet: "project_worktree: managed secondary worktrees for cross-repo changes by this same agent",
    promptGuidelines: ["Call project_context before changing a related repo. Prepare returns an absolute checkout path; use that path for file tools and commands. Do not edit the target's main checkout. Land or discard only on user authorization. Supply worktreeId to github_read/github_write/github_watch for target-repo PR work. The chat's default repo remains unchanged."],
    parameters: Type.Object({ action: Type.Union([Type.Literal("prepare"), Type.Literal("status"), Type.Literal("land"), Type.Literal("discard-preview"), Type.Literal("discard")]),
      projectId: id, worktreeId: id, requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), confirmationToken: id }),
    async execute(callId, params, _signal, _onUpdate, ctx) {
      const ref = { id: ctx.sessionManager.getSessionId(), cwd };
      if (params.action === "prepare") return result(await deps.work.prepare(ref, required(params.projectId, "projectId"), params.requestId ?? callId));
      const record = await deps.work.requireOwned(ref, required(params.worktreeId, "worktreeId"));
      if (params.action === "status") return result(await deps.worktrees.info(record, ref.id));
      if (params.action === "discard-preview") return result(await deps.worktrees.discardPreview(record.id));
      // Confirm the original session still owns a writable context before mutations.
      await deps.work.assertWritable(ref);
      if (params.action === "land") {
        if (record.state.kind === "active" && record.setup.phase !== "done") throw new Error("Finish setup before landing this worktree.");
        return result(await deps.worktrees.land(record.id, [], ref.id));
      }
      return result(await deps.worktrees.discard(record.id, required(params.confirmationToken, "confirmationToken"), [], ref.id));
    },
  });
  return [read, worktree];
}
