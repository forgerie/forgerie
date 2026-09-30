// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { browserTransport } from "./sessionStore";

afterEach(() => vi.restoreAllMocks());
it("requests recovery on return to the page, network return, and BFCache restore, then removes every listener", () => {
  const recover = vi.fn();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const unwatch = browserTransport.watchRecovery!(recover);
  try {
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recover).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(recover).toHaveBeenCalledTimes(3);
    unwatch();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(recover).toHaveBeenCalledTimes(3);
  } finally { unwatch(); }
});
