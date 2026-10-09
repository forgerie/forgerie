import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { drawDiagram, type DrawnDiagram } from "./drawDiagram";
import "./Diagram.css";

/**
 * How long the source must stay unchanged before drawing. Streamed text grows
 * every few tens of milliseconds, so a still source means the block is
 * finished, or the stream paused. Either way a draw is worth it then.
 */
export const DIAGRAM_QUIET_MS = 250;

type Drawing = { type: "waiting" } | { type: "drawn"; diagram: DrawnDiagram } | { type: "failed" };

type Labels = { diagram: string; source: string; copy: string; failed: string };
const LABELS: Labels = {
  diagram: "Diagram", source: "Source", copy: "Copy diagram source",
  failed: "This diagram could not be drawn. Its source is below.",
};

/**
 * System molecule: a Mermaid diagram from its source. Until the source is
 * still and drawn, the source itself is the content, so nothing is hidden
 * while a reply streams or when the source is invalid. A wide diagram keeps a
 * readable scale and scrolls inside its frame instead of shrinking to fit.
 */
export function Diagram({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const frame = useRef<HTMLElement>(null);
  const [drawing, setDrawing] = useState<Drawing>({ type: "waiting" });
  const [scheme, setScheme] = useState(0);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const redraw = () => setScheme((count) => count + 1);
    media?.addEventListener("change", redraw);
    return () => media?.removeEventListener("change", redraw);
  }, []);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      if (!frame.current || code.trim() === "") return;
      drawDiagram(code, frame.current).then(
        (diagram) => { if (current) setDrawing({ type: "drawn", diagram }); },
        () => { if (current) setDrawing({ type: "failed" }); });
    }, DIAGRAM_QUIET_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [code, scheme]);

  const source = <pre className="diagram-code"><code>{code}</code></pre>;
  return <figure ref={frame} className="diagram" data-drawing={drawing.type}>
    {drawing.type === "drawn"
      ? <div className="diagram-canvas" role="img" aria-label={labels.diagram} tabIndex={0}
        style={{ "--diagram-width": `${drawing.diagram.width}px` }} dangerouslySetInnerHTML={{ __html: drawing.diagram.svg }} />
      : <>
        {drawing.type === "failed" && <div className="diagram-status" role="status">{labels.failed}</div>}
        {source}
      </>}
    {drawing.type === "drawn" && <figcaption className="diagram-footer">
      <details className="diagram-source">
        <summary className="diagram-source-toggle">{labels.source}</summary>
        {source}
      </details>
      <span className="diagram-copy"><CopyButton label={labels.copy} getText={() => code} /></span>
    </figcaption>}
  </figure>;
}
