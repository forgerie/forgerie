import { useState } from "react";
import { ArchiveIcon, Trash2Icon } from "lucide-react";
import type { ArchiveAvailability } from "../picker/archiveNext";
import { ConfirmDialog } from "./ConfirmDialog";

/** Header close-and-next control. Permanent deletes use the existing destructive confirmation. */
export function ArchiveNextButton({ availability, onArchive, deletion }: { availability: ArchiveAvailability; onArchive: () => void; deletion?: { title: string; message: string } | undefined }) {
  const ephemeral = deletion !== undefined;
  const [confirming, setConfirming] = useState(false);
  const label = ephemeral ? "Delete and next" : "Archive and next";
  const Icon = ephemeral ? Trash2Icon : ArchiveIcon;
  const ready = availability.type === "ready";
  return <>
    <button type="button" className="icon-button quiet-button" aria-label={label} disabled={!ready}
      title={ready ? ephemeral ? "Permanently delete this ephemeral session and open the next one waiting for you" : "Archive this session and open the next one waiting for you" : `${label}: ${availability.reason}`}
      onClick={() => { if (ephemeral) setConfirming(true); else onArchive(); }}><Icon aria-hidden size={18} /></button>
    {deletion && confirming ? <ConfirmDialog title={deletion.title} confirmLabel="Delete permanently" held={!ready}
      icon={<Trash2Icon aria-hidden size={16} />} onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onArchive(); }}>
      <p>{deletion.message}</p>
    </ConfirmDialog> : null}
  </>;
}
