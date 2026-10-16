import { Fragment } from "react";
import "./StageMarks.css";

/** One step of a plan: its name, how many units of work it will start, and whether the reader decides there. */
export interface StageMark { name: string; marks: number; stop?: boolean | undefined }

/**
 * Atom: a plan's steps in order, drawn from tally marks before any of them runs. Each step shows one outlined mark
 * per unit of work it will start (outlined: not reached yet) and its name; a step where the reader decides shows one
 * mark ringed in ink and its name in full ink. Steps wrap onto more lines rather than being cut, so every step stays
 * readable at any width. Decorative: the words around it say the same, so it is hidden from assistive technology.
 */
export function StageMarks({ stages }: { stages: readonly StageMark[] }) {
  return <span className="stage-marks" aria-hidden>
    {stages.map((stage, index) => <Fragment key={`${String(index)}-${stage.name}`}>
      {index > 0 && <span className="stage-marks-sep" />}
      <span className="stage-marks-stage" data-stop={stage.stop || undefined}>
        {stage.stop ? <span className="stage-marks-mark" data-stop="" />
          : stage.marks > 0 && <span className="stage-marks-marks">{Array.from({ length: stage.marks }, (_, mark) => <span key={mark} className="stage-marks-mark" />)}</span>}
        {stage.name}
      </span>
    </Fragment>)}
  </span>;
}
