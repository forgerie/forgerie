// Adapted from assistant-ui's attachment registry. See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";

/** System molecule: one file chip, shared by composer and user messages. */
function Attachment() {
  const aui = useAui();
  const attachment = useAuiState((s) => s.attachment);
  const removable = aui.attachment.source !== "message";
  const disabled = useAuiState((s) => s.thread.isDisabled || s.composer.submission !== undefined);
  const [source, setSource] = useState<string>();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const image = attachment.content?.find((part) => part.type === "image");
  const inline = image?.type === "image" && /^data:image\/(jpeg|png|gif|webp);base64,/.test(image.image) ? image.image : undefined;
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
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const failure = attachment.status.type === "incomplete" && attachment.status.reason === "error" ? attachment.status : undefined;
  const failed = failure !== undefined;
  const uploading = attachment.status.type === "running";
  return <AttachmentPrimitive.Root className="attachment" data-error={failed || undefined}>
    {source ? <button type="button" className="attachment-image" aria-label={`Preview ${attachment.name}`} onClick={() => setOpen(true)}>
      <img src={source} alt={attachment.name} />
    </button> : <FileTextIcon aria-hidden className="attachment-file" size={20} />}
    <div className="attachment-info">
      <span className="attachment-name" title={attachment.name}><AttachmentPrimitive.Name /></span>
      {failure ? <span role="alert" className="attachment-error">{failure.message ?? "Upload failed. Send again to retry, or remove this file."}</span>
        : <span className="attachment-detail">{uploading ? "Uploading…" : attachment.type === "image" ? "Image" : "Saved in workspace on send"}</span>}
    </div>
    {removable && <AttachmentPrimitive.Remove className="icon-button quiet-button attachment-remove" disabled={disabled}
      aria-label={`Remove ${attachment.name}`} title={`Remove ${attachment.name}`}><XIcon aria-hidden size={14} /></AttachmentPrimitive.Remove>}
    {open && source && createPortal(<dialog ref={dialog} className="attachment-dialog" onClose={() => setOpen(false)} aria-label={attachment.name}>
      <button type="button" className="icon-button quiet-button" autoFocus aria-label="Close image preview" onClick={() => dialog.current?.close()}><XIcon aria-hidden size={18} /></button>
      <img src={source} alt={attachment.name} />
    </dialog>, document.body)}
  </AttachmentPrimitive.Root>;
}

export function ComposerAttachments() {
  return <div className="composer-attachments"><ComposerPrimitive.Attachments>{() => <Attachment />}</ComposerPrimitive.Attachments></div>;
}
export function UserMessageAttachments() {
  return <div className="message-attachments"><MessagePrimitive.Attachments>{() => <Attachment />}</MessagePrimitive.Attachments></div>;
}
export function AddAttachment({ disabled }: { disabled: boolean }) {
  return <ComposerPrimitive.AddAttachment className="icon-button quiet-button composer-add-attachment" disabled={disabled} multiple
    aria-label="Add attachment" title="Add attachment"><PlusIcon aria-hidden size={16} /></ComposerPrimitive.AddAttachment>;
}
export function AttachmentErrors() {
  const [error, setError] = useState<string>();
  useAuiEvent("composer.attachmentAddError", ({ message }) => setError(message));
  return error ? <p role="alert" className="attachment-notice">{error}<button type="button" className="quiet-button" onClick={() => setError(undefined)}>Dismiss</button></p> : null;
}
