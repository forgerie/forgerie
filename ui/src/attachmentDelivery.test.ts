import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_DELIVERY_KEY, createAttachmentDeliveryPreference } from "./attachmentDelivery";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe("attachment delivery preference", () => {
  it("attaches images to the message by default, and reads the classic UI's saved choice", () => {
    expect(createAttachmentDeliveryPreference(() => memoryStorage()).get()).toBe("inline");
    expect(createAttachmentDeliveryPreference(() => memoryStorage({ [ATTACHMENT_DELIVERY_KEY]: "folder" })).get()).toBe("folder");
    expect(createAttachmentDeliveryPreference(() => memoryStorage({ [ATTACHMENT_DELIVERY_KEY]: "nonsense" })).get()).toBe("inline");
  });

  it("saves a change and tells every listener once", () => {
    const storage = memoryStorage();
    const preference = createAttachmentDeliveryPreference(() => storage);
    const listener = vi.fn();
    const stop = preference.subscribe(listener);
    preference.set("folder");
    preference.set("folder");
    expect(preference.get()).toBe("folder");
    expect(storage.values.get(ATTACHMENT_DELIVERY_KEY)).toBe("folder");
    expect(listener).toHaveBeenCalledOnce();
    stop();
    preference.set("inline");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps the choice for the page when storage is blocked", () => {
    const preference = createAttachmentDeliveryPreference(() => ({
      getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); },
    }));
    expect(preference.get()).toBe("inline");
    preference.set("folder");
    expect(preference.get()).toBe("folder");
  });
});
