import type { SessionActivity, SessionStatus } from "./api";

/**
 * The session status strip is the single meta row for a session. It fuses what
 * used to be a floating activity dock over the transcript with the token/cost
 * bar under the composer, so the transcript keeps the space instead.
 */
export interface SessionActivityIndicator {
  text: string;
  active: boolean;
}

export interface SessionActivityIndicatorInput {
  status?: SessionStatus | undefined;
  activity?: SessionActivity | undefined;
  isSendingPrompt?: boolean | undefined;
}

function activityState(status: SessionStatus | undefined, activity: SessionActivity | undefined): string | undefined {
  if (status === undefined) return activity?.label;
  if (status.isCompacting) return "compacting";
  if (status.isBashRunning) return "bash";
  if (status.isStreaming) return "running";
  if (status.pendingMessageCount > 0) return "queued";
  return "idle";
}

function activityText(state: string, activity: SessionActivity | undefined): string {
  if (activity === undefined) return state;
  if (state !== "idle" && activity.phase === "idle") return state;
  return activity.detail !== undefined && activity.detail !== "" ? `${activity.label}: ${activity.detail}` : activity.label;
}

export function sessionActivityIndicator(input: SessionActivityIndicatorInput): SessionActivityIndicator | undefined {
  if (input.isSendingPrompt === true) return { text: "Sending your message…", active: true };
  const state = activityState(input.status, input.activity);
  if (state === undefined) return undefined;
  return {
    text: activityText(state, input.activity),
    active: state !== "idle" || input.activity?.phase === "active",
  };
}
