import { redactDecisionArguments, redactDecisionText } from "./decisionPayloadRedaction.js";
import { Check } from "typebox/value";
import { RiskLabelSchema, type RiskLabel } from "../../shared/riskLabels.js";
import type { GatedCategory } from "../../shared/autonomyPolicy.js";
import type { DecisionHints } from "./decisionHints.js";
import type { DecisionAnswers, DecisionRequest } from "./decisionClient.js";

interface RiskLabelInput {
  tool: string;
  args: unknown;
  cwd: string;
  gate?: { category: GatedCategory; description: string };
}
export interface RiskLabelOptions { hints: RiskLabelHints; onError: (error: unknown) => void }
type RiskLabelHints = Pick<DecisionHints, "client" | "readSettings">;
const enabled = (hints: RiskLabelHints) => {
  const settings = hints.readSettings();
  return settings.enabled && settings.risk_labels && settings.baseUrl.trim() !== "" ? settings : undefined;
};
function labelOf(result: DecisionAnswers): RiskLabel | undefined {
  const { deletes_data: deletes, outside_worktree: outside, acts_as_user: user, risk } = result.answers;
  if (deletes?.type !== "noul" || outside?.type !== "noul" || user?.type !== "noul" || risk?.type !== "score") return undefined;
  const label = { model: result.model, deletes_data: deletes.noul, outside_worktree: outside.noul, acts_as_user: user.noul,
    risk: ["low", "check", "danger"][Math.round(risk.score)], risk_score: risk.score };
  return Check(RiskLabelSchema, label) ? label : undefined;
}

/** Even settings reads and request construction run outside admission/execution's await chain.
 * Publication uses an independent optional store and must only add information.
 */
export function launchRiskLabel(hints: RiskLabelHints | undefined, input: RiskLabelInput,
  publish: (label: RiskLabel) => void | Promise<void>, onError: (error: unknown) => void): void {
  if (hints === undefined) return;
  void Promise.resolve().then(async () => {
    const settings = enabled(hints);
    if (settings === undefined) return;
    const cwd = redactDecisionText(input.cwd);
    const request: DecisionRequest = { model: settings.model,
      state: { tool: redactDecisionText(input.tool), arguments: redactDecisionArguments(input.args).slice(0, 8000), cwd,
        ...(input.gate === undefined ? {} : { category: input.gate.category, description: redactDecisionText(input.gate.description).slice(0, 4000) }) },
      questions: {
        deletes_data: { type: "noul", instructions: "Does this delete or overwrite data?" },
        outside_worktree: { type: "noul", instructions: `Does this act outside the working directory ${cwd}?` },
        acts_as_user: { type: "noul", instructions: "Does this publish, send or change something under the user's name outside this machine?" },
        risk: { type: "score", instructions: "Assess the risk of this action. This is information only, not approval.", criteria: ["low", "check", "danger"] },
      },
    };
    const result = await hints.client.ask(request);
    if (result === undefined || enabled(hints) === undefined) return;
    const label = labelOf(result);
    if (label !== undefined) await publish(label);
  }).catch(onError);
}
