import { expect } from "vitest";
import { createDecisionClient, type DecisionClient } from "./decisionClient.js";
import { readDecisionHintsSettings, type DecisionHintsSettings } from "./decisionHintsSettings.js";

export type DecisionHintEquivalenceMode = "baseline" | "off" | "unconfigured" | "unreachable" | "hanging";
export interface DecisionHintEquivalenceContext {
  mode: DecisionHintEquivalenceMode;
  /** Baseline omits the collaborator; the other runs use the real decision client. */
  client: DecisionClient | undefined;
  settings: DecisionHintsSettings;
}
export interface DecisionHintEquivalenceScenario<T> {
  /** Return a fresh snapshot of user-visible results, events and durable state. */
  observe: () => T | Promise<T>;
  dispose?: () => void | Promise<void>;
}

/** Runs the same scenario without hints, off, unconfigured, unreachable and hanging.
 * Compares observations before and after background asks settle. The hanging run
 * fails if the scenario waits for the gateway timeout before returning.
 * The injected transport fails deterministically; no external service or port is needed.
 */
export async function assertDecisionHintOffEquivalence<T>(
  scenario: (context: DecisionHintEquivalenceContext) => DecisionHintEquivalenceScenario<T> | Promise<DecisionHintEquivalenceScenario<T>>,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  let baselineImmediate: T | undefined;
  let baselineSettled: T | undefined;
  const modes: DecisionHintEquivalenceMode[] = ["baseline", "off", "unconfigured", "unreachable", "hanging"];
  for (const mode of modes) {
    const settings = { ...readDecisionHintsSettings({}), enabled: mode !== "baseline" && mode !== "off", baseUrl: mode === "unconfigured" ? "" : "http://decision-gateway.invalid" };
    const pending: Promise<unknown>[] = [];
    let timeoutViolation: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { timeoutViolation = reject; });
    const transport: typeof fetch = (_url, init) => {
      if (mode !== "hanging") return Promise.reject(new Error("Gateway unreachable"));
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          timeoutViolation?.(new Error("The scenario waited for the decision gateway timeout"));
          reject(new Error("Gateway timeout"));
        };
        if (init?.signal?.aborted === true) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    const realClient = createDecisionClient({ readConfig: () => settings, fetch: transport, timeoutMs: options.timeoutMs ?? 250 });
    const client: DecisionClient | undefined = mode === "baseline" ? undefined : { ask(request) {
      const result = realClient.ask(request); pending.push(result); return result;
    } };
    let run: DecisionHintEquivalenceScenario<T> | undefined;
    // Capture the eventual resource owner even when a timeout violation wins the race.
    const started = Promise.resolve().then(() => scenario({ mode, client, settings })).then((value) => { run = value; return value; });
    try {
      const active = await Promise.race([started, deadline]);
      const immediate = structuredClone(await active.observe());
      timeoutViolation = undefined;
      if (mode === "baseline") baselineImmediate = immediate;
      else expect(immediate, `${mode}: immediate observations`).toStrictEqual(baselineImmediate);
      for (const task of pending) await task;
      const settled = structuredClone(await active.observe());
      if (mode === "baseline") baselineSettled = settled;
      else expect(settled, `${mode}: settled observations`).toStrictEqual(baselineSettled);
    } finally {
      await started;
      await Promise.all(pending);
      await run?.dispose?.();
    }
  }
}
