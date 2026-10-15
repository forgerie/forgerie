import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { z } from "zod";
import { riskToolIdentity, type RiskToolIdentity } from "../../shared/riskLabels.js";

const inputSchema = z.object({assistant: z.number().int().positive()});
/** Read-only lookup, launched outside the tool await chain. Capture identity before the invocation ends. */
export async function readToolRiskIdentity(api: ToolExecutionApi, context: Context, ordinal = 0): Promise<RiskToolIdentity | undefined> {
  const task = await api.getTask(api.taskId, context);
  const input = inputSchema.safeParse(task?.input);
  return input.success ? riskToolIdentity(api.conversationId, input.data.assistant, api.callId, ordinal) : undefined;
}
