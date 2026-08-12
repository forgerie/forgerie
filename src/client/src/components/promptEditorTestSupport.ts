import type { SessionStatus } from "../api";
import type { ComposerCapabilities } from "../composerCapabilities";

export interface SessionCapabilityOptions {
  status?: SessionStatus;
  runtimeAvailable?: boolean;
  stoppable?: boolean;
  sessionLabel?: string;
  availableThinkingLevels?: readonly string[];
  onSelectModel?: () => void;
  onSelectThinking?: () => void;
  onSetGuidance?: (entryId: string, enabled: boolean) => Promise<boolean>;
  onStop?: () => void;
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
  return {
    ...(label === undefined || label === "" ? {} : { context: [{ id: "session", label, title: label }] }),
    model: {
      ...(status?.model === undefined ? {} : { model: status.model }),
      ...(status?.thinkingLevel === undefined ? {} : { thinkingLevel: status.thinkingLevel }),
      availableThinkingLevels: options.availableThinkingLevels ?? [],
      changeable: runtimeAvailable,
      onSelectModel: options.onSelectModel ?? (() => undefined),
      onSelectThinking: options.onSelectThinking ?? (() => undefined),
    },
    guidance: {
      activeIds: status?.activeGuidanceIds ?? [],
      changeable: runtimeAvailable,
      onSet: options.onSetGuidance ?? (() => Promise.resolve(true)),
    },
    stop: { stoppable: (options.stoppable ?? false) && runtimeAvailable, onStop: options.onStop ?? (() => undefined) },
    newSession: { onNewSession: options.onNewSession ?? (() => undefined) },
    ...(options.onArchiveAndNext === undefined ? {} : { archive: { onArchiveAndNext: options.onArchiveAndNext } }),
    ...(status?.contextUsage === undefined ? {} : { contextUsage: status.contextUsage }),
  };
}
