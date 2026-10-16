import { CircleCheckIcon, CircleDashedIcon, CircleMinusIcon, CirclePauseIcon, CircleSlashIcon, CircleXIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import "./StateMark.css";

/** Where a unit of automated work stands. `unknown`: it could not be read. */
export type WorkState = "queued" | "waiting" | "running" | "passed" | "failed" | "cancelled" | "skipped" | "unknown";

const ICON: Record<WorkState, typeof CircleXIcon> = {
  queued: CircleDashedIcon, waiting: CirclePauseIcon, running: LoaderCircleIcon, passed: CircleCheckIcon,
  failed: CircleXIcon, cancelled: CircleMinusIcon, skipped: CircleSlashIcon, unknown: TriangleAlertIcon,
};

/**
 * Atom: one icon for where a job or a build stands, in its tone: a cross for
 * a failure, a check for a pass, a turning ring while it runs, a pause while
 * it waits on someone, and quiet marks for the rest. The shape carries the
 * state as much as the hue does, so it reads without colour. Decorative: the
 * words beside it name the state.
 */
export function StateMark({ state, size = "body" }: { state: WorkState; size?: "body" | "large" }) {
  const Icon = ICON[state];
  return <Icon aria-hidden className="state-mark" data-state={state} data-size={size} />;
}
