import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import "./RouteMap.css";

/** done: finished. working: at work now. waiting: waits on the reader. next: not reached. */
export type RouteState = "done" | "working" | "waiting" | "next";

/** One worker inside a step, drawn as a track. A track with `onPress` opens that worker. */
export interface RouteTrack {
  key: string;
  name: string;
  state: RouteState;
  /** Short facts under the name, such as who does it, on which branch, and the last thing it did. */
  lines?: readonly ReactNode[];
  /** Trouble the worker works through on its own, such as a model error it retries: lines in the warn tone, after the plain lines. */
  notice?: readonly string[] | undefined;
  /** Accessible name of the press, such as "Open design". */
  label?: string;
  onPress?: () => void;
}

export interface RouteStep {
  key: string;
  name: string;
  state: RouteState;
  /** The reader is the actor at this step: drawn as a ring, not a dot. */
  mine?: boolean;
  /** Overrides the state word after the name, such as "approved by you, 14:06". */
  word?: string;
  does?: string;
  tracks?: readonly RouteTrack[];
  /** Anything else that hangs from the step, such as review findings. */
  detail?: ReactNode;
}

const WORD: Record<RouteState, string> = { done: "Done", working: "Working", waiting: "Waiting for you", next: "" };

/**
 * Molecule: a route of steps on one rail, oldest first. A step the reader acts
 * at is a ring; a step at work is filled in the live colour; a finished step is
 * checked, and the rail behind it takes the done colour. A step's workers sit
 * under it as tracks, side by side while the container has room and stacked
 * when it does not. Each track can open its worker.
 */
export function RouteMap({ label, steps }: { label: string; steps: readonly RouteStep[] }) {
  return <ol className="route-map" aria-label={label}>
    {steps.map((step) => {
      const word = step.word ?? (step.state === "next" && step.mine === true ? "You" : WORD[step.state]);
      return <li key={step.key} className="route-map-step" data-state={step.state} data-mine={step.mine || undefined}>
        <span className="route-map-mark" data-state={step.state} data-mine={step.mine || undefined} aria-hidden>{step.state === "done" && <CheckIcon />}</span>
        <div className="route-map-body">
          <p className="route-map-head"><span className="route-map-name">{step.name}</span>{word !== "" && <span className="route-map-word">{word}</span>}</p>
          {step.does !== undefined && <p className="route-map-does">{step.does}</p>}
          {step.tracks !== undefined && step.tracks.length > 0 && <ul className="route-map-tracks">
            {step.tracks.map((track) => {
              const inner = <>
                <span className="route-map-track-head">
                  <span className="route-map-dot" data-state={track.state} aria-hidden />
                  <span className="route-map-track-name">{track.name}</span>
                  {WORD[track.state] !== "" && <span className="route-map-track-word">{WORD[track.state]}</span>}
                </span>
                {track.lines?.map((line, index) => <span key={index} className="route-map-track-line">{line}</span>)}
                {track.notice?.map((line, index) => <span key={`notice-${String(index)}`} className="route-map-track-notice">{line}</span>)}
              </>;
              return <li key={track.key} className="route-map-track" data-state={track.state}>
                {track.onPress === undefined ? <div className="route-map-track-body">{inner}</div>
                  : <button type="button" className="route-map-track-body" aria-label={track.label ?? track.name} onClick={track.onPress}>
                    {inner}<ChevronRightIcon className="route-map-track-open" aria-hidden />
                  </button>}
              </li>;
            })}
          </ul>}
          {step.detail}
        </div>
      </li>;
    })}
  </ol>;
}
