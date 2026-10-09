// Adapted from assistant-ui's attachment registry. See THIRD_PARTY_NOTICES.md.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ComposerPrimitive, MessagePrimitive, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import { attachmentImage, attachmentImages, type ViewerImage } from "../images";
import { useImageViewer } from "./ImageViewer";
import { offersDeliveryChoice, oversizedImage } from "../attachments";
import { DELIVERY_WORDS, attachmentDelivery, type AttachmentDelivery } from "../attachmentDelivery";
import { FileTile } from "./FileTile";
import { TileStrip } from "./TileStrip";
import { ToggleGroup } from "./ToggleGroup";

/** The page's one delivery choice. Every composer reads and writes the same value. */
export function useAttachmentDelivery(): AttachmentDelivery {
  return useSyncExternalStore(attachmentDelivery.subscribe, attachmentDelivery.get);
}

/**
 * One file as a tile, shared by the composer and sent messages. `browse` is
 * the image set the viewer moves through; without it the tile's own image
 * opens alone. The tile says nothing the delivery choice already says: a
 * note appears only for what the reader could not guess.
 */
function Attachment({ browse }: { browse?: readonly ViewerImage[] }) {
  const aui = useAui();
  const openViewer = useImageViewer();
  const attachment = useAuiState((s) => s.attachment);
  const removable = aui.attachment.source !== "message";
  const delivery = useAttachmentDelivery();
  const disabled = useAuiState((s) => s.thread.isDisabled || s.composer.submission !== undefined);
  const [source, setSource] = useState<string>();
  const inline = attachmentImage(attachment);
  const file = attachment.file;
  useEffect(() => {
    if (attachment.type === "image" && file && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(file);
      setSource(url);
      return () => URL.revokeObjectURL(url);
    }
    setSource(inline);
    return undefined;
  }, [file, inline, attachment.type]);
  const open = () => {
    if (!source) return;
    const index = browse?.findIndex((image) => image.id === attachment.id) ?? -1;
    if (browse && index >= 0) openViewer(browse, index);
    else openViewer([{ id: attachment.id, src: source, alt: attachment.name }], 0);
  };
  const failed = attachment.status.type === "incomplete" && attachment.status.reason === "error";
  const uploading = attachment.status.type === "running";
  const note = failed ? "Not added" : uploading ? "Uploading…"
    : removable && delivery === "inline" && oversizedImage(attachment) ? DELIVERY_WORDS.tooLarge : undefined;
  return <FileTile name={attachment.name} preview={source} note={note} failed={failed} busy={uploading} onOpen={open}
    {...removable ? { onRemove: () => aui.attachment.remove(), removeDisabled: disabled } : {}} />;
}

/** The draft's files as one row of tiles. `children` is the one control for all of them, at the row's end. */
export function ComposerAttachments({ children }: { children?: ReactNode }) {
  const count = useAuiState((s) => s.composer.attachments.length);
  // Joined, so the selector returns a value that compares equal between renders.
  const failures = useAuiState((s) => s.composer.attachments.flatMap((attachment) =>
    attachment.status.type === "incomplete" && attachment.status.reason === "error"
      ? [`${attachment.name}: ${attachment.status.message ?? "Upload failed. Send again to retry, or remove this file."}`] : []).join("\n"));
  if (count === 0) return null;
  return <div className="composer-attachments">
    <TileStrip label={count === 1 ? "1 attached file" : `${count} attached files`} end={children} alerts={failures ? failures.split("\n") : []}>
      <ComposerPrimitive.Attachments>{() => <Attachment />}</ComposerPrimitive.Attachments>
    </TileStrip>
  </div>;
}
export function UserMessageAttachments() {
  const attachments = useAuiState((s) => s.message.attachments);
  const browse = useMemo(() => attachmentImages(attachments ?? []), [attachments]);
  if (!attachments?.length) return null;
  return <div className="message-attachments"><TileStrip label="Attached files" align="end">
    <MessagePrimitive.Attachments>{() => <Attachment browse={browse} />}</MessagePrimitive.Attachments>
  </TileStrip></div>;
}
export function AddAttachment({ disabled }: { disabled: boolean }) {
  return <ComposerPrimitive.AddAttachment className="icon-button quiet-button composer-add-attachment" disabled={disabled} multiple
    aria-label="Add attachment" title="Add attachment"><PlusIcon aria-hidden size={16} /></ComposerPrimitive.AddAttachment>;
}

/**
 * Send images inline, or save them to the workspace like any file. It shows
 * only while the draft holds an image the choice decides. A saved image
 * travels as its path, so it can queue while the agent works.
 */
export function AttachmentDeliveryChoice({ disabled = false }: { disabled?: boolean }) {
  const delivery = useAttachmentDelivery();
  const offered = useAuiState((s) => offersDeliveryChoice(s.composer.attachments));
  if (!offered) return null;
  return <ToggleGroup label={DELIVERY_WORDS.lead} lead={DELIVERY_WORDS.lead} options={DELIVERY_WORDS.options} value={delivery} disabled={disabled}
    onChange={(value) => attachmentDelivery.set(value)} />;
}
/** A file that could not be added. One that stays in the draft says why under the tiles instead. */
export function AttachmentErrors() {
  const [failure, setFailure] = useState<{ message: string; id?: string | undefined }>();
  useAuiEvent("composer.attachmentAddError", ({ message, attachmentId }) => setFailure({ message, id: attachmentId }));
  const shown = useAuiState((s) => failure?.id !== undefined && s.composer.attachments.some((attachment) => attachment.id === failure.id));
  const error = shown ? undefined : failure?.message;
  const setError = setFailure;
  return error ? <p role="alert" className="attachment-notice">{error}<button type="button" className="quiet-button" onClick={() => setError(undefined)}>Dismiss</button></p> : null;
}
