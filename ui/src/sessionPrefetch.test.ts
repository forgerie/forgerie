import { describe, expect, it, vi } from "vitest";
import { createSessionPrefetch } from "./sessionPrefetch";
import type { Row } from "./picker/board";
const row = (id: string, state: Row["state"] = "open"): Row => ({ session: { id, cwd: "/work", modified: "now" }, state, group: state === "archived" ? "archived" : "open", location: { projectKey: "p", project: "P" }, time: "now", working: false, busy: false, agents: 0, processes: 0, flagged: 0 });
describe("speculative session intent", () => {
  it("ignores archived rows and cancels idle work when hidden", () => {
    const prefetch = vi.fn(), cancel = vi.fn(), cancelIdle = vi.fn(); let run: (() => void) | undefined; let allowed = true;
    const intents = createSessionPrefetch({ prefetch, cancelPrefetch: cancel, getSnapshot: () => [] }, { allowed: () => allowed, idle: callback => { run = callback; return cancelIdle; } });
    intents.intent(row("archived", "archived")); expect(prefetch).not.toHaveBeenCalled();
    intents.idle([row("normal"), row("unread", "unread")]); run?.(); expect(prefetch).toHaveBeenCalledExactlyOnceWith(row("unread").session);
    allowed = false; intents.pause(); run?.(); expect(prefetch).toHaveBeenCalledTimes(1); expect(cancelIdle).toHaveBeenCalled();
    intents.cancel(row("normal")); expect(cancel).toHaveBeenCalledExactlyOnceWith(row("normal").session);
  });
});
