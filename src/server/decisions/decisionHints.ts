import type { LoadOptions } from "../../config.js";
import type { DecisionHintsStatus } from "../../shared/decisionHints.js";
import { createDecisionClient, type DecisionClient } from "./decisionClient.js";
import { createDecisionHintsSettingsReader, type DecisionHintsSettings } from "./decisionHintsSettings.js";

/** Distinguish optional annotation errors from pre-existing extension errors. */
export const DECISION_HINT_ERROR_EVENT = "forgerie.decision-hint";

/** Inject this collaborator into background hint consumers. It has no authority over gates or turns. */
export interface DecisionHints {
  client: DecisionClient;
  readSettings: () => DecisionHintsSettings;
  status: () => DecisionHintsStatus;
}

export function createDecisionHints(options: LoadOptions & {
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): DecisionHints {
  const apiKey = options.env["DECISION_GATEWAY_API_KEY"]?.trim();
  const readSettings = createDecisionHintsSettingsReader(options);
  return {
    readSettings,
    client: createDecisionClient({ readConfig: readSettings, ...(apiKey === undefined ? {} : { apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }),
    status: () => ({ keyPresent: apiKey !== undefined && apiKey !== "" }),
  };
}
