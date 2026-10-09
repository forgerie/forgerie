import { Type } from "typebox";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";
import { modelParameterDescription, requestedModel } from "./requestedModel.js";

export type HandoffSessionModel = NonNullable<ExtensionContext["model"]>;
export type HandoffSessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;
export type HandoffState = "requested" | "destination-created" | "source-detached" | "preparing" | "ready" | "failed" | "continuation-failed";

export interface HandoffSessionInvocation {
  spawningCwd: string;
  sourceSessionId: string;
  sourceSessionFile: string;
  sourceLeafId: string | undefined;
  focus: string | undefined;
  cwd: string | undefined;
  model?: HandoffSessionModel;
  modelSpec?: string;
  thinkingLevel?: HandoffSessionThinkingLevel;
}

export interface HandoffSessionResult {
  handoffId: string;
  sourceSessionId: string;
  destinationSessionId: string;
  cwd: string;
  model?: string;
  state: "preparing";
}

export interface HandoffSessionToolDeps {
  handoff(input: HandoffSessionInvocation): Promise<HandoffSessionResult>;
}

const HandoffSessionParams = Type.Object({
  focus: Type.Optional(Type.String({
    description: "What the destination session should focus on. Omit to continue the current work as-is.",
  })),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the destination. Must be a workspace of the same project. Defaults to this session's workspace.",
  })),
  model: Type.Optional(Type.String({
    description: modelParameterDescription("the destination session"),
  })),
});

/** Create the one-call detached handoff boundary exposed to hosted agents. */
export function createHandoffSessionToolDefinition(spawningCwd: string, deps: HandoffSessionToolDeps) {
  return defineTool<typeof HandoffSessionParams, HandoffSessionResult>({
    name: "handoff_session",
    exposure: MODEL_ONLY_EXPOSURE,
    label: "Hand off session",
    description: "Immediately create a continuation session and move context preparation there. Call only when the user explicitly asks to hand off or continue in a fresh session.",
    promptSnippet: "handoff_session: create the continuation immediately; call alone and last",
    promptGuidelines: [
      "When the user requests a handoff, call handoff_session immediately. Do not summarize first. Call it alone and last because it ends this run.",
    ],
    parameters: HandoffSessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sourceSessionFile = ctx.sessionManager.getSessionFile();
      if (sourceSessionFile === undefined || sourceSessionFile.trim() === "") {
        throw new Error("Current session transcript is not durable yet; retry the handoff after the session file exists.");
      }
      const result = await deps.handoff({
        spawningCwd,
        sourceSessionId: ctx.sessionManager.getSessionId(),
        sourceSessionFile,
        sourceLeafId: ctx.sessionManager.getLeafId() ?? undefined,
        focus: params.focus,
        cwd: params.cwd,
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...requestedModel(params.model, ctx.thinkingLevel),
      });
      const modelNote = result.model === undefined ? "" : ` using model ${result.model}`;
      return {
        content: [{
          type: "text",
          text: `Started detached handoff ${result.handoffId}. Destination session ${result.destinationSessionId} is preparing in ${result.cwd}${modelNote}.`,
        }],
        details: result,
        terminate: true,
      };
    },
  });
}
