import type { ReactNode } from "react";

/**
 * System atom: the box that gives rendered Markdown the transcript's type: headings, lists, links, tables and
 * quotes, as a reply draws them (`.markdown` in theme.css). `className` adds the owner's own layout.
 */
export function MarkdownSurface({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return <div className={className ? `markdown ${className}` : "markdown"}>{children}</div>;
}
