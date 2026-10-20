import { afterEach, describe, expect, it, vi } from "vitest";
import { createChildAgentsStore } from "./childAgentsStore";
import { CHILDREN } from "./fixtures/children";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); vi.useRealTimers(); });
function fixture() {
  const pending: { path: string; signal: AbortSignal | null | undefined; resolve: (response: Response) => void }[] = [];
  const store = createChildAgentsStore((path, init) => new Promise<Response>(resolve => { pending.push({ path, signal: init.signal, resolve }); }),
    () => ({ id: "parent", cwd: "/workspace" }), { refreshDelayMs: 1, pollMs: 100 });
  cleanup.push(store.dispose);
  return { store, pending };
}
const transcript = (text: string) => Response.json({ messages: [{ role: "assistant", content: text }], busy: false });

describe("child reads follow their selection and lifetime", () => {
  it("cancels a superseded list and ignores its late unavailable response", async () => {
    vi.useFakeTimers();
    const { store, pending } = fixture();
    store.refresh(); await vi.advanceTimersByTimeAsync(2);
    store.refresh(); await vi.advanceTimersByTimeAsync(2);
    expect(pending[0]?.signal?.aborted).toBe(true);
    pending[1]?.resolve(Response.json(CHILDREN)); await vi.advanceTimersByTimeAsync(0);
    pending[0]?.resolve(Response.json({ error: "Unavailable" }, { status: 404 })); await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({ available: true, children: CHILDREN });
  });

  it("does not let an old response overwrite a child closed and reopened with the same identity", async () => {
    vi.useFakeTimers();
    const { store, pending } = fixture();
    store.open(1); store.close(); store.open(1);
    expect(pending[0]?.signal?.aborted).toBe(true);
    pending[1]?.resolve(transcript("new")); await vi.advanceTimersByTimeAsync(0);
    pending[0]?.resolve(transcript("old")); await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().open?.transcript?.messages[0]?.content).toBe("new");
  });

  it("pauses hidden child reads without clearing the selection or draft, then catches up once", async () => {
    vi.useFakeTimers();
    const { store, pending } = fixture();
    store.open(1); store.updateDraft("message", () => "unsent");
    store.setVisible(false);
    expect(pending[0]?.signal?.aborted).toBe(true);
    pending[0]?.resolve(transcript("old")); await vi.advanceTimersByTimeAsync(0);
    store.refresh(); store.refresh(); await vi.advanceTimersByTimeAsync(1000);
    expect(pending).toHaveLength(1);
    store.setVisible(true); await vi.advanceTimersByTimeAsync(2);
    expect(pending.filter(read => read.path.endsWith("/messages?cwd=%2Fworkspace"))).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ open: { conversationId: 1 }, drafts: { message: "unsent" } });
    pending.findLast(read => read.path.includes("/messages?"))?.resolve(transcript("caught up"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().open?.transcript?.messages[0]?.content).toBe("caught up");
  });

  it("aborts reads on disposal and cannot schedule more work from their late completions", async () => {
    vi.useFakeTimers();
    const { store, pending } = fixture();
    store.open(1); store.dispose();
    expect(pending[0]?.signal?.aborted).toBe(true);
    pending[0]?.resolve(transcript("late")); await vi.advanceTimersByTimeAsync(1000);
    store.refresh(); await vi.advanceTimersByTimeAsync(1000);
    expect(pending).toHaveLength(1);
    expect(store.getSnapshot().open?.transcript).toBeUndefined();
  });
});
