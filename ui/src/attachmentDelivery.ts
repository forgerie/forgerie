/**
 * How an image reaches Pi. "inline" attaches it to the message itself. "folder"
 * saves it in the workspace and sends its path, like any other file. Files that
 * are not images always go to the folder: Pi takes only images as model input.
 */
export type AttachmentDelivery = "inline" | "folder";
export const ATTACHMENT_FOLDER = ".forgerie/attachments";

/** The classic UI's key, so the choice is the same in both UIs on one origin. Not sensitive. */
export const ATTACHMENT_DELIVERY_KEY = "pi-web:attachment-delivery";

export interface AttachmentDeliveryPreference {
  get(): AttachmentDelivery;
  set(delivery: AttachmentDelivery): void;
  subscribe(listener: () => void): () => void;
}

export function createAttachmentDeliveryPreference(storage: () => Pick<Storage, "getItem" | "setItem"> | undefined): AttachmentDeliveryPreference {
  let current: AttachmentDelivery = "inline";
  try { if (storage()?.getItem(ATTACHMENT_DELIVERY_KEY) === "folder") current = "folder"; }
  catch { /* Blocked storage: the default holds. */ }
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(delivery) {
      if (delivery === current) return;
      current = delivery;
      try { storage()?.setItem(ATTACHMENT_DELIVERY_KEY, delivery); }
      catch { /* Full or blocked storage: the choice then lasts for this page only. */ }
      for (const listener of listeners) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** One choice for every composer in this page, so a new session and an open one agree. */
export const attachmentDelivery = createAttachmentDeliveryPreference(() => {
  try { return window.localStorage; } catch { return undefined; }
});
