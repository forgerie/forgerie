import { useId, useRef, type ReactNode } from "react";
import { useDescribedControls } from "../useDescribedControls";

/**
 * System molecule: one property row. Label beside the value while the column has room, above it when it does not.
 * A problem shows under the value in the danger tone and marks the row, so a refused save can find it; the hint and
 * the problem describe the row's controls to a screen reader. `fieldId` names the row, so a page can move focus to it.
 */
export function SettingsField({ label, hint, problem, children, id, fieldId }: {
  label: string; hint?: ReactNode; problem?: string | undefined; children: ReactNode; id?: string; fieldId?: string | undefined;
}) {
  const own = useId();
  const value = useRef<HTMLDivElement>(null);
  const hintId = hint ? `${own}-hint` : undefined;
  const problemId = problem ? `${own}-problem` : undefined;
  useDescribedControls(value, [problemId, hintId], problem !== undefined);
  return <div className="agent-field" id={fieldId} data-problem={problem ? "" : undefined}>
    <span className="agent-field-label" id={id}>{label}</span>
    <div className="agent-field-value" ref={value}>{children}</div>
    {hint ? <p className="agent-field-hint" id={hintId}>{hint}</p> : null}
    {problem ? <p className="agent-field-problem" id={problemId}>{problem}</p> : null}
  </div>;
}
