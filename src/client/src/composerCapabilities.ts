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
  readonly dismiss?: ComposerDismissCapability;
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
  /**
   * The catalogue, read when the choice is opened.
   *
   * The host owns where models come from; the composer owns how they are
   * shown, so both surfaces present the same list without restating it.
   */
  readonly listModels: () => Promise<readonly ComposerSelectableModel[]>;
  readonly onChooseModel: (model: ComposerSelectableModel) => void;
  readonly onChooseThinkingLevel: (level: string) => void;
}

export interface ComposerSelectableModel {
  readonly provider?: string;
  readonly id?: string;
  readonly name?: string;
  readonly contextWindow?: number;
  /** True when Pi's `enabledModels` scope holds this model, so Ctrl+P reaches it. */
  readonly scoped?: boolean;
  /**
   * Pi reports this loosely, so it is read as a flag only when it is a boolean.
   * False clamps the thinking level to `off`.
   */
  readonly reasoning?: unknown;
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
 * A way out of the composer, for a host that has one.
 *
 * The chat has none: leaving a session is a shell action. A new-session
 * composer does, and it belongs beside the control that commits, so leaving
 * costs no more searching than sending.
 */
export interface ComposerDismissCapability {
  readonly label?: string;
  readonly disabled?: boolean;
  readonly onDismiss: () => void;
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
  /** `branch` earns a mark, because being off the main worktree is unusual. */
  readonly kind?: "plain" | "branch";
  readonly label: string;
  readonly title?: string;
  readonly action?: ComposerContextChipAction;
}

export interface ComposerContextChipAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onActivate: () => void;
}
