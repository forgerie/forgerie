import type { SessionStatus } from "../../shared/apiTypes";

/**
 * What a composer host can actually do.
 *
 * The composer renders a control because a host declared it, never because a
 * field happened to be set. A host that cannot choose a model omits `model`;
 * a host with no session to stop omits `stop`. Both surfaces build one of
 * these, so a control offered on one is offered on the other as soon as its
 * host can supply the state behind it.
 */
export interface ComposerCapabilities {
  readonly model?: ComposerModelCapability;
  readonly guidance?: ComposerGuidanceCapability;
  readonly stop?: ComposerStopCapability;
  readonly archive?: ComposerArchiveCapability;
  readonly newSession?: ComposerNewSessionCapability;
  /** Drawn as the island's own top edge; absent below the reporting threshold. */
  readonly contextUsage?: SessionStatus["contextUsage"];
  /** Where the composer stands: a session's identity, or a chosen destination. */
  readonly context?: readonly ComposerContextChip[];
}

export interface ComposerModelCapability {
  readonly model?: SessionStatus["model"];
  readonly thinkingLevel?: string;
  readonly availableThinkingLevels?: readonly string[];
  /** False while the choice is known but cannot be changed yet. */
  readonly changeable?: boolean;
  readonly onSelectModel: () => void;
  readonly onSelectThinking: () => void;
}

export interface ComposerGuidanceCapability {
  readonly activeIds: readonly string[];
  readonly changeable?: boolean;
  readonly onSet: (entryId: string, enabled: boolean) => Promise<boolean>;
}

export interface ComposerStopCapability {
  readonly stoppable: boolean;
  readonly onStop: () => void;
}

export interface ComposerArchiveCapability {
  readonly onArchiveAndNext: () => void;
}

export interface ComposerNewSessionCapability {
  readonly onNewSession: () => void;
}

/**
 * A short, quiet statement of where the composer is pointed.
 *
 * A chat session states its identity and cannot be repointed. A new-session
 * composer states its destination and offers to change it, so a chip carries
 * an optional action rather than the composer knowing either case.
 */
export interface ComposerContextChip {
  readonly id: string;
  readonly label: string;
  readonly title?: string;
  readonly action?: ComposerContextChipAction;
}

export interface ComposerContextChipAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onActivate: () => void;
}
