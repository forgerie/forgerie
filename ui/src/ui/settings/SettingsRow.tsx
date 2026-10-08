import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

/** System molecule: one settings destination, with facts that wrap before its navigation mark yields. */
export function SettingsRow({ name, description, meta, flags, replaced, onOpen }: {
  name: ReactNode; description?: ReactNode; meta?: ReactNode; flags?: ReactNode; replaced?: boolean; onOpen: () => void;
}) {
  return <li><button type="button" className="agent-row" onClick={onOpen} data-replaced={replaced || undefined}>
    <span className="agent-row-name">{name}</span>
    {meta ? <span className="agent-row-model">{meta}</span> : null}
    {description ? <span className="agent-row-description">{description}</span> : null}
    <span className="agent-row-flags">{flags}</span>
    <ChevronRightIcon aria-hidden size={16} className="agent-row-chevron" />
  </button></li>;
}
