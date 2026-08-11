/**
 * What the composer's control rail offers, derived once from session state.
 *
 * The rail holds one row and never grows: an idle session has no use for
 * steering, so the working controls take the same slots the idle ones had
 * rather than appearing beside them. Deriving that here keeps the composer
 * from re-deciding it inline, where "is this session busy" was previously
 * spelled three different ways.
 */
export interface ComposerRailInput {
  /** The session cannot be used at all — archived, or otherwise closed to input. */
  disabled: boolean;
  /** A send is already in flight from this client. */
  sending: boolean;
  /** The agent is producing a reply right now. */
  isStreaming: boolean;
  /** History is being compacted; input is accepted but queued. */
  isCompacting: boolean;
  /** There is work a stop would actually end. */
  stoppable: boolean;
}

export interface ComposerRail {
  /** `working` whenever input would be queued rather than sent straight through. */
  kind: "idle" | "working";
  primaryAction: "send" | "queue";
  canInvokePrimary: boolean;
  canSteer: boolean;
  canStop: boolean;
}

export function composerRail(input: ComposerRailInput): ComposerRail {
  const working = input.isStreaming || input.isCompacting;
  const usable = !input.disabled;
  return {
    kind: working ? "working" : "idle",
    primaryAction: working ? "queue" : "send",
    canInvokePrimary: usable && !input.sending,
    // Compaction has no reply in flight to redirect, so steering is offered
    // only while the agent is actually speaking.
    canSteer: usable && input.isStreaming && !input.isCompacting,
    canStop: usable && input.stoppable,
  };
}
