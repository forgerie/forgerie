import type { ReactNode } from "react";
import { BlockRun } from "./BlockRun";
import "./Afterword.css";

/** Supporting output in the reply text column: content with a quiet source, or one live/error line. */
export function Afterword(props: { kind: "content"; source: string; children: ReactNode } | { kind: "working" | "failed"; message: string }) {
  return <div className="afterword">
    {props.kind === "content" ? <>{props.children}<p className="afterword-source">{props.source}</p></>
      : <p className="afterword-status" role={props.kind === "working" ? "status" : "alert"}>
        {props.kind === "working" && <BlockRun tones={["live"]} />}{props.message}
      </p>}
  </div>;
}
