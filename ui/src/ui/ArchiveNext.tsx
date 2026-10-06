import { ArchiveIcon } from "lucide-react";
import type { ArchiveAvailability } from "../picker/archiveNext";

/**
 * Header control: archive this session and open the next one that wants you.
 * Disabled with its reason as the title when it cannot run, so it never vanishes.
 */
export function ArchiveNextButton({ availability, onArchive }: { availability: ArchiveAvailability; onArchive: () => void }) {
  const ready = availability.type === "ready";
  return <button type="button" className="icon-button quiet-button" aria-label="Archive and next" disabled={!ready}
    title={ready ? "Archive this session and open the next one waiting for you" : `Archive and next: ${availability.reason}`}
    onClick={onArchive}><ArchiveIcon aria-hidden size={18} /></button>;
}
