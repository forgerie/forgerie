import { describe, expect, it, vi } from "vitest";
import { SESSION_SEEN_INPUT_MS, SESSION_SEEN_INTERVAL_MS, createSessionPresence, type PresenceEnvironment } from "./sessionPresence";

function fixture() {
  let now = 0, visible = true;
  const listeners = new Map<string, () => void>();
  let tick = () => {};
  const repeat = vi.fn<(callback: () => void, delay: number) => () => void>((callback) => { tick = callback; return () => { tick = () => {}; }; });
  const environment: PresenceEnvironment = { now: () => now, visible: () => visible,
    listen: (type, listener) => { listeners.set(type, listener); return () => { listeners.delete(type); }; }, repeat };
  const arrive = vi.fn<(active: boolean) => Promise<void>>(() => Promise.resolve());
  const seen = vi.fn<(keepalive: boolean) => Promise<void>>(() => Promise.resolve());
  const failed = vi.fn();
  const presence = createSessionPresence({ environment, arrive, seen, failed });
  return { presence, arrive, seen, failed, repeat, listeners, tick: () => { tick(); },
    input: (type = "pointerdown") => listeners.get(type)?.(),
    advance: (duration: number) => { now += duration; },
    visibility: (next: boolean) => { visible = next; listeners.get("visibilitychange")?.(); } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("session presence", () => {
  it("arrives only on selection/visibility edges, never on readiness refreshes", async () => {
    const f = fixture();
    f.presence.setSelected(true); expect(f.arrive).not.toHaveBeenCalled();
    f.presence.setReady(true); await settle(); expect(f.arrive).toHaveBeenCalledExactlyOnceWith(false);
    f.presence.setReady(false); f.presence.setReady(true); f.presence.setSelected(true); await settle();
    expect(f.arrive).toHaveBeenCalledTimes(1);
    f.presence.setSelected(false); f.presence.setSelected(true); await settle(); expect(f.arrive).toHaveBeenCalledTimes(2);
    f.visibility(false); f.visibility(true); await settle(); expect(f.arrive).toHaveBeenCalledTimes(3);
    f.presence.dispose(); expect(f.listeners.size).toBe(0);
  });
  it("heartbeats require recent input, selected session and visible page; timers are injected", async () => {
    const f = fixture();
    f.presence.setReady(true); f.presence.setSelected(true); await settle();
    expect(f.repeat).toHaveBeenCalledWith(expect.any(Function), SESSION_SEEN_INTERVAL_MS);
    f.tick(); expect(f.seen).not.toHaveBeenCalled();
    f.input(); expect(f.seen).toHaveBeenCalledExactlyOnceWith(false);
    f.input("wheel"); expect(f.seen).toHaveBeenCalledTimes(1);
    f.advance(SESSION_SEEN_INTERVAL_MS); f.tick(); expect(f.seen).toHaveBeenCalledTimes(2);
    f.advance(SESSION_SEEN_INPUT_MS + 1); f.tick(); expect(f.seen).toHaveBeenCalledTimes(2);
    f.input("keydown"); expect(f.seen).toHaveBeenCalledTimes(3);
    f.visibility(false); expect(f.seen).toHaveBeenLastCalledWith(true);
    const sent = f.seen.mock.calls.length;
    f.input(); f.tick(); expect(f.seen).toHaveBeenCalledTimes(sent);
    f.presence.setSelected(false); f.presence.dispose();
  });
  it("includes the immediate seen heartbeat in arrival and waits for its snapshot handshake before more heartbeats", async () => {
    const f = fixture(); let finish!: () => void;
    f.arrive.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.input("touchstart"); f.presence.setSelected(true); f.presence.setReady(true); await settle();
    expect(f.arrive).toHaveBeenCalledExactlyOnceWith(true);
    f.tick(); f.input(); expect(f.seen).not.toHaveBeenCalled();
    finish(); await settle(); expect(f.seen).not.toHaveBeenCalled();
    f.advance(SESSION_SEEN_INTERVAL_MS); f.tick(); expect(f.seen).toHaveBeenCalledExactlyOnceWith(false);
    f.presence.setSelected(false); expect(f.seen).toHaveBeenLastCalledWith(true);
    f.presence.dispose();
  });
  it("reports heartbeat failures and stops its cadence on disposal", async () => {
    const f = fixture();
    f.presence.setReady(true); f.presence.setSelected(true); await settle();
    f.seen.mockRejectedValue(new Error("offline")); f.input("scroll"); await settle();
    expect(f.failed).toHaveBeenCalledWith(new Error("offline"));
    f.presence.dispose(); const sent = f.seen.mock.calls.length; f.tick(); expect(f.seen).toHaveBeenCalledTimes(sent);
  });
});
