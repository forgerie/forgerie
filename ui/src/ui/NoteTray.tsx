import { FileDiffIcon, XIcon } from "lucide-react";
import { fileName, noteRange, type DiffNote } from "../changes/diffNotes";

/** The message box's view of the notes that wait for the next message. */
export interface NotesBinding {
  notes: readonly DiffNote[];
  /** Open the review, with this note in view. */
  onOpen: (noteId: string) => void;
  onRemove: (id: string) => void;
  /** Send the notes as a message with no text. `steer` reaches the current response. */
  onSendAlone: (steer: boolean) => Promise<void>;
}

/**
 * System molecule: one chip per note, inside the input bar beside the files.
 * A chip names the file and lines and opens the note; its x removes it.
 */
export function NoteTray({ binding, disabled }: { binding: NotesBinding; disabled: boolean }) {
  return <ul className="note-tray" aria-label="Notes on changes, sent with your next message">
    {binding.notes.map((note) => {
      const where = `${fileName(note.path)}:${noteRange(note.lines)}`;
      return <li key={note.id} className="note-chip">
        <button type="button" className="note-chip-open" title={`${note.path}, ${noteRange(note.lines)}\n${note.comment}`}
          aria-label={`Note on ${where}: ${note.comment}`} onClick={() => binding.onOpen(note.id)}>
          <FileDiffIcon aria-hidden size={14} />
          <span className="note-chip-where">{where}</span>
          <span className="note-chip-text">{note.comment}</span>
        </button>
        <button type="button" className="note-chip-remove" aria-label={`Remove the note on ${where}`} title="Remove note"
          disabled={disabled} onClick={() => binding.onRemove(note.id)}><XIcon aria-hidden size={14} /></button>
      </li>;
    })}
  </ul>;
}
