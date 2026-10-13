import { forwardRef } from "react";
import "./ProblemList.css";

/**
 * Atom: what stops a form from being saved, as a short list in the danger
 * tone. It takes focus when a save is refused, so the reader hears why.
 */
export const ProblemList = forwardRef<HTMLDivElement, { label: string; problems: readonly string[] }>(function ProblemList({ label, problems }, ref) {
  if (problems.length === 0) return null;
  return <div ref={ref} className="problem-list" role="alert" tabIndex={-1} aria-label={label}>
    <ul className="problem-list-items">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
  </div>;
});
