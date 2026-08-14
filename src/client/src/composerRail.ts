/**
 * What the composer's control rail offers, derived once from session state.
 *
 * The rail holds one row and never grows. Idle sessions spend the primary slot
 * on Send. Any stoppable work puts Stop in that same slot. Queue is a separate
 * capability that appears only when the server accepts follow-up delivery
 * behind streaming or compaction.
 */
export interface ComposerRailInput {
  /** The session cannot be used at all — archived, or otherwise closed to input. */
  disabled: boolean;
  /** The draft cannot be submitted right now. */
  submissionAvailable: boolean;
  /** This host currently has a send destination. */
  sendAvailable: boolean;
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
  /** Current rail case. Queue-capable work is the only draft-working case. */
  kind: "idle" | "stopOnly" | "queueCapable";
  /** The control occupying Send's slot. */
  primaryAction: "send" | "stop";
  canInvokePrimary: boolean;
  canQueue: boolean;
  canInvokeQueue: boolean;
  canSteer: boolean;
  canStop: boolean;
}

export function composerRail(input: ComposerRailInput): ComposerRail {
  const usable = !input.disabled;
  const sendGateOpen = usable && input.submissionAvailable && input.sendAvailable && !input.sending;
  const queueCapable = input.isStreaming || input.isCompacting;
  const kind: ComposerRail["kind"] = queueCapable ? "queueCapable" : input.stoppable ? "stopOnly" : "idle";
  const primaryAction: ComposerRail["primaryAction"] = kind === "idle" ? "send" : "stop";
  const canStop = usable && input.stoppable;
  const canInvokePrimary = primaryAction === "send" ? sendGateOpen : canStop;
  return {
    kind,
    primaryAction,
    canInvokePrimary,
    canQueue: queueCapable,
    canInvokeQueue: sendGateOpen && queueCapable,
    // Compaction has no reply in flight to redirect, so steering is offered
    // only while the agent is actually speaking.
    canSteer: usable && input.isStreaming && !input.isCompacting,
    canStop,
  };
}
