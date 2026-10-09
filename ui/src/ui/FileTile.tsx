import { XIcon } from "lucide-react";
import "./FileTile.css";

/** The file's type as a short mark, from its name: "notes.txt" gives "TXT". */
export function typeMark(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return /^[a-z0-9]{1,5}$/i.test(extension) ? extension.toUpperCase() : "FILE";
}

/**
 * Atom: one file as a square tile. A picture fills the tile, because the
 * picture is what the reader recognises; any other file shows its type. The
 * name sits under the tile. A note says only what the reader could not guess
 * from the tile, such as "Uploading…" or how this one file travels.
 * A failed file carries a short failure in its note; the full text belongs
 * next to the tiles.
 */
export function FileTile({ name, preview, note, failed = false, busy = false, onOpen, onRemove, removeDisabled = false }: {
  name: string;
  /** An image URL. Without one the tile shows the file's type. */
  preview?: string | undefined;
  note?: string | undefined;
  failed?: boolean;
  busy?: boolean;
  /** Opens the preview at full size. */
  onOpen?: (() => void) | undefined;
  /** Without it the tile has no remove button, as in a sent message. */
  onRemove?: (() => void) | undefined;
  removeDisabled?: boolean;
}) {
  const face = preview ? <img src={preview} alt="" draggable={false} /> : <span className="file-tile-type" aria-hidden>{typeMark(name)}</span>;
  return <figure className="file-tile" data-failed={failed || undefined} data-busy={busy || undefined} aria-busy={busy || undefined}>
    {preview && onOpen ? <button type="button" className="file-tile-face" aria-label={`Preview ${name}`} onClick={onOpen}>{face}</button>
      : <span className="file-tile-face">{face}</span>}
    <figcaption className="file-tile-caption">
      <span className="file-tile-name" title={name}>{name}</span>
      {note && <span className="file-tile-note">{note}</span>}
    </figcaption>
    {onRemove && <button type="button" className="file-tile-remove" aria-label={`Remove ${name}`} title={`Remove ${name}`}
      disabled={removeDisabled} onClick={onRemove}><XIcon aria-hidden size={12} strokeWidth={2.5} /></button>}
  </figure>;
}
