import { AUTONOMY_GUIDANCE } from "./autonomyGuidance.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";
import { assertReplyWritten, assertTerminalToolAlone, previousToolRefusedReply, responseFromBranch } from "./sessionResponse.js";

export const END_TURN_TOOL_NAME = "end_turn";

// The model gets one completion path. Execution still accepts pre-schema saved arguments.
const Parameters = Type.Object({ reply: Type.String({ minLength: 1, pattern: "\\S", description: "Your visible final answer or question. Required and nonblank. Thinking is not visible." }), awaiting: Type.Union([Type.Literal("nothing"), Type.Literal("reply")], { description: "reply only for categories (a), (b), (c) in the autonomy rule, a physical or observation request, or explicit user consultation; nothing for a result or completion report." }) });
type SavedArguments = Omit<Static<typeof Parameters>, "reply"> & { reply?: string };

/** The declaration is durable before the run ends. No sidebar state is written. */
export interface EndTurnToolDeps { declare(awaiting: "nothing" | "reply", reply?: string): void | Promise<void> }
export function createEndTurnToolDefinition(deps: EndTurnToolDeps) {
  return defineTool({
    name: END_TURN_TOOL_NAME,
    exposure: MODEL_ONLY_EXPOSURE,
    label: "End turn",
    description: "End this run and declare whether you need a user reply. Call this tool alone and supply your final answer or question in the required reply field. Use ask_user instead for a browser question form.",
    promptSnippet: "end_turn: end every run with awaiting=reply or awaiting=nothing; always put your nonblank answer or question in reply; ask_user also ends a run",
    promptGuidelines: [AUTONOMY_GUIDANCE, "End every run with end_turn, unless ask_user or another turn-ending tool already ends it. Put your final answer or question in the required, nonblank reply parameter, then call end_turn alone and last. Do not send a separate copy as text. Thinking is not shown to the user. If validation rejects a call, correct the required reply field. Set awaiting to reply only for categories (a), (b), (c) in the autonomy rule, a physical or observation request, or when the user explicitly asked to be consulted. Otherwise set it to nothing. A run without a declaration is shown as Needs your response. Never use end_turn while work remains to be completed in this run, including an in-scope next step you would otherwise offer to do. Do that work instead."],
    parameters: Parameters,
    execute(toolCallId, params: SavedArguments, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch();
      assertTerminalToolAlone(branch, toolCallId);
      let reply: string | undefined;
      try { assertReplyWritten(branch); }
      catch (cause) {
        if (params.reply !== undefined && params.reply.trim() !== "") reply = params.reply;
        else {
          if (!previousToolRefusedReply(branch, END_TURN_TOOL_NAME)) throw cause;
          // Stop the retry loop without declaring a silent success or copying private thinking into text.
          return Promise.resolve({ content: [{ type: "text", text: "The run stopped after two failed attempts to end without a visible reply. No completion was recorded. Send another message to continue." }], details: { reason: "missing-reply", recovery: "exhausted" }, isError: true, terminate: true });
        }
      }
      if (responseFromBranch(branch).pendingAsk !== undefined) throw new Error("An unanswered ask_user form is already waiting for the user. Do not replace it with end_turn.");
      return Promise.resolve(reply === undefined ? deps.declare(params.awaiting) : deps.declare(params.awaiting, reply)).then(() => ({ content: [{ type: "text" as const, text: params.awaiting === "reply" ? "Needs your response." : "No response requested." }], details: { awaiting: params.awaiting }, terminate: true }));
    },
  });
}
