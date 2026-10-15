import { useId, useRef, type ReactNode } from "react";
import { TextButton } from "./TextButton";
import { useDescribedControls } from "./useDescribedControls";
import "./PageSection.css";

/**
 * Molecule: a titled part of a document page: a small quiet heading, then its content at the column's full width.
 * A problem with the section's content shows under it in the danger tone and describes the controls inside, and
 * `fieldId` names the section, so a page can move focus to it. One quiet action can sit at the heading's end, such
 * as Pause; with `pressed` it is a toggle. `spacing="panel"` sets sections in a side panel apart by a rule and a
 * smaller gap, with none above the first.
 */
export function PageSection({ title, problem, fieldId, action, spacing = "page", children }: {
  title: string; problem?: string | undefined; fieldId?: string | undefined;
  action?: { label: string; pressed?: boolean | undefined; title?: string | undefined; disabled?: boolean | undefined; onPress: () => void } | undefined;
  spacing?: "page" | "panel" | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const problemId = problem ? `${id}-problem` : undefined;
  useDescribedControls(body, [problemId], problem !== undefined);
  return <section className="page-section" id={fieldId} data-problem={problem ? "" : undefined} data-spacing={spacing === "panel" ? spacing : undefined} aria-labelledby={id}>
    <div className="page-section-head">
      <h2 className="page-section-title" id={id}>{title}</h2>
      {action ? <TextButton label={action.label} pressed={action.pressed} title={action.title} disabled={action.disabled} onPress={action.onPress} /> : null}
    </div>
    <div ref={body}>{children}</div>
    {problem ? <p className="page-section-problem" id={problemId}>{problem}</p> : null}
  </section>;
}
