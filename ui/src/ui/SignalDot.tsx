import "./SignalDot.css";

/**
 * System atom: a yes-or-no signal with no level, such as a service that
 * answers or refuses. Neutral ink when on, the danger tone when off. As a
 * `run`, the dots fill the width they are given, so the signal takes a lane
 * beside meters that do have a level and says, by having no end, that it has
 * none. Without a label it is decoration and hidden from assistive technology.
 */
export function SignalDot({ off = false, run = false, label }: { off?: boolean; run?: boolean; label?: string | undefined }) {
  return <i className="signal-dot" data-off={off || undefined} data-run={run || undefined} role={label ? "img" : undefined} aria-label={label}
    title={label} aria-hidden={label ? undefined : true} />;
}
