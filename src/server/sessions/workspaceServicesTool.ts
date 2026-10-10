import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ManagedWorktreeRequired, type WorkspaceServices } from "../workspaces/workspaceServices.js";

export function createWorkspaceServicesTool(cwd: string, services: WorkspaceServices) {
  return defineTool({
    name: "workspace_services", label: "Workspace services", executionMode: "sequential",
    description: "Manage the current managed worktree's declared Process Compose services. Read status or bounded logs, start, stop, restart a service, or wait for readiness with a deadline. Services survive Forgerie restarts. Start executes repository code and needs explicit user approval. This does not manage ad-hoc process tool commands.",
    promptSnippet: "workspace_services: declared development services scoped to this worktree, with readiness and bounded logs",
    promptGuidelines: ["Use wait with a deadline rather than polling status repeatedly. Start the project without a service name before individual controls. Set approve=true only after the user approves execution of this repository's services. Stop services before worktree removal. Service data remains retained after shutdown. Never start a second Process Compose instance with a shell command."],
    parameters: Type.Object({
      action: Type.Union([Type.Literal("status"), Type.Literal("logs"), Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart"), Type.Literal("wait")]),
      service: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000 })),
      approve: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    async execute(_callId, params, signal) {
      signal?.throwIfAborted();
      const id = await services.forCwd(cwd);
      signal?.throwIfAborted();
      let value: unknown;
      if (params.action === "status") value = await services.status(id, signal);
      else if (params.action === "logs") {
        if (params.service === undefined) throw new Error("logs requires a service name");
        value = await services.logs(id, params.service, params.lines ?? 50);
      } else if (params.action === "wait") value = await services.wait(id, { timeoutMs: params.timeoutMs ?? 30_000, ...(params.service === undefined ? {} : { service: params.service }) }, signal);
      else value = await services.action(id, { action: params.action, ...(params.service === undefined ? {} : { service: params.service }), ...(params.approve === undefined ? {} : { approve: params.approve }) });
      signal?.throwIfAborted();
      return { content: [{ type: "text", text: JSON.stringify(value) }], details: undefined };
    },
  });
}

export interface WorkspaceServicesObserver {
  extension: InlineExtension;
  dispose(): void;
}

/** Observations enter the next turn's context. They never start an agent turn merely to poll services. */
export function createWorkspaceServicesObserver(cwd: string, services: WorkspaceServices): WorkspaceServicesObserver {
  let disposeCurrent: (() => void) | undefined;
  let disposed = false;
  const extension: InlineExtension = { name: "forgerie-workspace-services", hidden: true, factory(pi) {
    disposeCurrent?.();
    if (disposed) return;
    let detach: (() => void) | undefined;
    let stopped = false;
    const shutdown = () => { stopped = true; detach?.(); detach = undefined; };
    disposeCurrent = shutdown;
    pi.on("session_start", async () => {
      let id: string;
      try { id = await services.forCwd(cwd); }
      catch (error) { if (error instanceof ManagedWorktreeRequired) return; throw error; }
      if (stopped) return;
      detach?.();
      let previous = "";
      detach = services.subscribe(id, (snapshot) => {
        const noteworthy = snapshot.kind === "unavailable" ? ["unavailable"] : snapshot.kind === "running" ? snapshot.processes.filter((item) => item.kind === "ready" || item.kind === "failed").map((item) => `${item.name}: ${item.kind}, restarts ${String(item.restarts)}`) : [];
        const summary = noteworthy.join("\n");
        if (summary === previous) return;
        previous = summary;
        if (summary !== "") pi.sendMessage({ customType: "forgerie-workspace-services", content: `Workspace services changed:\n${summary}`, display: true }, { triggerTurn: false, deliverAs: "nextTurn" });
      });
    });
    pi.on("session_shutdown", shutdown);
  } };
  return { extension, dispose() { disposed = true; disposeCurrent?.(); disposeCurrent = undefined; } };
}
