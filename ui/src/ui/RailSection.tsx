import type { ReactNode } from "react";
import "./RailSection.css";

/**
 * System molecule: a run of supporting content set smaller and muted, hung
 * from a hairline at its start edge, and optionally closed by a labelled
 * rule that leads into what follows. The rule reaches into the start margin
 * by `--rail-reach`, so its label lines up with the content after it.
 */
export function RailSection({ end, children }: {
  /** The label on the closing rule. Without it the section has no rule. */
  end?: ReactNode;
  children: ReactNode;
}) {
  return <div className="rail-section" data-closed={end === undefined ? undefined : ""}>
    <div className="rail-section-body">{children}</div>
    {end !== undefined && <div className="rail-section-end" role="separator" aria-label={typeof end === "string" ? end : undefined}>
      <span className="rail-section-label">{end}</span>
    </div>}
  </div>;
}
