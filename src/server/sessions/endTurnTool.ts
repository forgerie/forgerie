import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";
import { assertTerminalToolAlone, responseFromBranch } from "./sessionResponse.js";

const Parameters = Type.Object({ awaiting: Type.Union([Type.Literal("nothing"), Type.Literal("reply")], { description: "reply when you need any response from the user; nothing when this is only a result or completion report." }) });

/** The declaration is durable before the run ends. No sidebar state is written. */
export interface EndTurnToolDeps { declare(awaiting: "nothing" | "reply"): void }
export function createEndTurnToolDefinition(deps: EndTurnToolDeps) {
  return defineTool({
    name: "end_turn",
    exposure: MODEL_ONLY_EXPOSURE,
    label: "End turn",
    description: "End this run and declare whether you need a user reply. Write your final answer or question before calling this tool alone. Use ask_user instead for a browser question form.",
    promptSnippet: "end_turn: end every run with awaiting=reply or awaiting=nothing; ask_user also ends a run",
    promptGuidelines: ["End every run with end_turn, unless ask_user or another turn-ending tool already ends it. Write your final text first, then call end_turn alone and last. Set awaiting to reply whenever you want the user to answer, decide, review, confirm, or supply information. Set it to nothing only when you have no request for the user. A run without a declaration is shown as Needs your response. Never use end_turn while work remains to be completed in this run."],
    parameters: Parameters,
    execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch();
      assertTerminalToolAlone(branch, toolCallId);
      if (responseFromBranch(branch).pendingAsk !== undefined) throw new Error("An unanswered ask_user form is already waiting for the user. Do not replace it with end_turn.");
      deps.declare(params.awaiting);
      return Promise.resolve({ content: [{ type: "text", text: params.awaiting === "reply" ? "Needs your response." : "No response requested." }], details: { awaiting: params.awaiting }, terminate: true });
    },
  });
}
