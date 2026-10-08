// Adapted from assistant-ui's attachment registry. See THIRD_PARTY_NOTICES.md.
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { attachmentImage, attachmentImages, type ViewerImage } from "../images";
import { useImageViewer } from "./ImageViewer";
import { offersDeliveryChoice, sendsInline } from "../attachments";
import { ATTACHMENT_FOLDER, attachmentDelivery, type AttachmentDelivery } from "../attachmentDelivery";

/** The page's one delivery choice. Every composer reads and writes the same value. */
export function useAttachmentDelivery(): AttachmentDelivery {
  return useSyncExternalStore(attachmentDelivery.subscribe, attachmentDelivery.get);
}

/**
 * System molecule: one file chip, shared by composer and user messages.
 * `browse` is the image set the viewer moves through; without it the chip's
 * own image opens alone.
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
  const failure = attachment.status.type === "incomplete" && attachment.status.reason === "error" ? attachment.status : undefined;
  const failed = failure !== undefined;
  const uploading = attachment.status.type === "running";
  return <AttachmentPrimitive.Root className="attachment" data-error={failed || undefined}>
    {source ? <button type="button" className="attachment-image" aria-label={`Preview ${attachment.name}`} onClick={open}>
      <img src={source} alt={attachment.name} />
    </button> : <FileTextIcon aria-hidden className="attachment-file" size={20} />}
    <div className="attachment-info">
      <span className="attachment-name" title={attachment.name}><AttachmentPrimitive.Name /></span>
      {failure ? <span role="alert" className="attachment-error">{failure.message ?? "Upload failed. Send again to retry, or remove this file."}</span>
        : <span className="attachment-detail">{uploading ? "Uploading…"
          : (removable ? sendsInline(attachment, delivery) : attachment.type === "image") ? "Image" : "Saved in workspace on send"}</span>}
    </div>
    {removable && <AttachmentPrimitive.Remove className="icon-button quiet-button attachment-remove" disabled={disabled}
      aria-label={`Remove ${attachment.name}`} title={`Remove ${attachment.name}`}><XIcon aria-hidden size={14} /></AttachmentPrimitive.Remove>}
  </AttachmentPrimitive.Root>;
}

/** The draft's chips. Children follow them inside the same height budget, so a short window scrolls them together. */
export function ComposerAttachments({ children }: { children?: ReactNode }) {
  return <div className="composer-attachments"><ComposerPrimitive.Attachments>{() => <Attachment />}</ComposerPrimitive.Attachments>{children}</div>;
}
export function UserMessageAttachments() {
  const attachments = useAuiState((s) => s.message.attachments);
  const browse = useMemo(() => attachmentImages(attachments ?? []), [attachments]);
  return <div className="message-attachments"><MessagePrimitive.Attachments>{() => <Attachment browse={browse} />}</MessagePrimitive.Attachments></div>;
}
export function AddAttachment({ disabled }: { disabled: boolean }) {
  return <ComposerPrimitive.AddAttachment className="icon-button quiet-button composer-add-attachment" disabled={disabled} multiple
    aria-label="Add attachment" title="Add attachment"><PlusIcon aria-hidden size={16} /></ComposerPrimitive.AddAttachment>;
}
/**
 * Attach images to the message, or save them to the workspace like any file.
 * It shows only while the draft holds an image the choice decides. A saved
 * image travels as its path, so it can queue while the agent works.
 */
export function AttachmentDeliveryChoice({ disabled = false }: { disabled?: boolean }) {
  const name = useId();
  const delivery = useAttachmentDelivery();
  const offered = useAuiState((s) => offersDeliveryChoice(s.composer.attachments));
  if (!offered) return null;
  const option = (value: AttachmentDelivery, label: string) => <label className="delivery-option">
    <input type="radio" name={name} value={value} checked={delivery === value} disabled={disabled}
      onChange={() => attachmentDelivery.set(value)} />
    <span>{label}</span>
  </label>;
  return <fieldset className="attachment-delivery" disabled={disabled}>
    <legend>Attachment delivery</legend>
    {option("inline", "Attach to message (images only)")}
    {option("folder", `Save to ${ATTACHMENT_FOLDER}`)}
  </fieldset>;
}
export function AttachmentErrors() {
  const [error, setError] = useState<string>();
  useAuiEvent("composer.attachmentAddError", ({ message }) => setError(message));
  return error ? <p role="alert" className="attachment-notice">{error}<button type="button" className="quiet-button" onClick={() => setError(undefined)}>Dismiss</button></p> : null;
}
