import { defineTool } from "@earendil-works/pi-coding-agent";
import { SuggestBacklogInputSchema, type BacklogSuggestionDestination } from "../../shared/backlogSuggestions.js";
import type { BacklogSuggestionService } from "../backlog/suggestions/suggestionService.js";
import { MODEL_ONLY_EXPOSURE } from "./codemode.js";

export type BacklogSuggestionToolDeps = Pick<BacklogSuggestionService, "suggest">;
export function createBacklogSuggestionTool(cwd: string, deps: BacklogSuggestionToolDeps) {
  return defineTool<typeof SuggestBacklogInputSchema, { suggestionId: string; destination: BacklogSuggestionDestination }>({
    name: "suggest_backlog", label: "Suggest backlog item", exposure: MODEL_ONLY_EXPOSURE, executionMode: "sequential",
    description: "Parent only: capture a backlog suggestion with its own context. Creates an open card, never files or starts work without a user click. Does not end the turn.",
    promptSnippet: "suggest_backlog: capture work for later, with why, files, and decisions",
    promptGuidelines: ["Use suggest_backlog when you would say 'we should backlog this'. Use file_issue only when the user asks to file now. Children suggest items in their reports; the parent calls suggest_backlog. Include enough context to work without the main chat. Keep working after suggesting."],
    parameters: SuggestBacklogInputSchema,
    async execute(_id, input, _signal, _update, ctx) {
      const title = ctx.sessionManager.getSessionName();
      const record = await deps.suggest(cwd, ctx.sessionManager.getSessionId(), input, {
        ...(title === undefined ? {} : { sessionTitle: title }),
        ...(ctx.model === undefined ? {} : { modelSpec: `${ctx.model.provider}/${ctx.model.id}` }),
        ...(ctx.thinkingLevel === undefined ? {} : { thinkingLevel: ctx.thinkingLevel }),
      });
      return { content: [{ type: "text", text: `Backlog suggestion saved. The user can File or File and act. Keep working in this chat.` }], details: { suggestionId: record.id, destination: record.destination } };
    },
  });
}
