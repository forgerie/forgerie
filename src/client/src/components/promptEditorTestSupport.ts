import { isSessionActive } from "../../../shared/activity";
import type { SessionStatus } from "../api";
import type { ComposerCapabilities, ComposerSelectableModel } from "../composerCapabilities";

export interface SessionCapabilityOptions {
  status?: SessionStatus;
  runtimeAvailable?: boolean;
  stoppable?: boolean;
  sessionLabel?: string;
  availableThinkingLevels?: readonly string[];
  listModels?: () => Promise<readonly ComposerSelectableModel[]>;
  onChooseModel?: (model: ComposerSelectableModel) => void;
  onChooseThinkingLevel?: (level: string) => void;
  onStop?: () => void;
  onOpenTree?: () => void;
  onArchiveAndNext?: () => void;
  onNewSession?: () => void;
}

/**
 * The capability set a chat session declares, as `PiWebApp` builds it.
 *
 * Tests share this so a change to what the chat offers is stated in one place
 * rather than restated in every composer test.
 */
export function sessionCapabilities(options: SessionCapabilityOptions = {}): ComposerCapabilities {
  const status = options.status;
  const runtimeAvailable = options.runtimeAvailable ?? true;
  const label = options.sessionLabel;
  const stoppable = options.stoppable ?? isSessionActive(status);
  return {
    ...(label === undefined || label === "" ? {} : { context: [{ id: "session", label, title: label }] }),
    model: {
      ...(status?.model === undefined ? {} : { model: status.model }),
      ...(status?.thinkingLevel === undefined ? {} : { thinkingLevel: status.thinkingLevel }),
      availableThinkingLevels: options.availableThinkingLevels ?? [],
      changeable: runtimeAvailable,
      listModels: options.listModels ?? (() => Promise.resolve([])),
      onChooseModel: options.onChooseModel ?? (() => undefined),
      onChooseThinkingLevel: options.onChooseThinkingLevel ?? (() => undefined),
    },
    stop: { stoppable: stoppable && runtimeAvailable, onStop: options.onStop ?? (() => undefined) },
    ...(runtimeAvailable ? { tree: { onOpenTree: options.onOpenTree ?? (() => undefined) } } : {}),
    newSession: { onNewSession: options.onNewSession ?? (() => undefined) },
    ...(options.onArchiveAndNext === undefined ? {} : { archive: { onArchiveAndNext: options.onArchiveAndNext } }),
    ...(status?.contextUsage === undefined ? {} : { contextUsage: status.contextUsage }),
  };
}
