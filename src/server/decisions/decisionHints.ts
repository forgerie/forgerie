import type { PiWebRuntimeComponent } from "../../shared/apiTypes.js";
import { DecisionGatewayKeyStore } from "./decisionGatewayKey.js";
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
  status: () => DecisionHintsStatus | Promise<DecisionHintsStatus>;
}

export function createDecisionHints(options: LoadOptions & {
  env: NodeJS.ProcessEnv;
  agentDir: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): DecisionHints & { gatewayKey: DecisionGatewayKeyStore } {
  const gatewayKey = new DecisionGatewayKeyStore(options);
  const readSettings = createDecisionHintsSettingsReader(options);
  return {
    readSettings, gatewayKey,
    client: createDecisionClient({ readConfig: readSettings, readApiKey: () => gatewayKey.readApiKey(),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }),
    status: () => gatewayKey.status(),
  };
}

/** Runtime always reports a repairable public status, including invalid files. */
export async function decisionHintsRuntimeStatus(hints: Pick<DecisionHints, "status">): Promise<Pick<PiWebRuntimeComponent, "decisionHints">> {
  return { decisionHints: await hints.status() };
}
