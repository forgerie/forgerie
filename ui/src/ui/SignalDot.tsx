import "./SignalDot.css";

/**
 * System atom: a yes-or-no signal with no level, such as a service that
 * answers or refuses. Neutral ink when on, the danger tone when off. Without
 * a label it is decoration and hidden from assistive technology.
 */
export function SignalDot({ off = false, label }: { off?: boolean; label?: string | undefined }) {
  return <i className="signal-dot" data-off={off || undefined} role={label ? "img" : undefined} aria-label={label} title={label}
    aria-hidden={label ? undefined : true} />;
}
