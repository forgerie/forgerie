import { describe, expect, it } from "vitest";

import { observeInputMode, ROW_ACTIONS_DISPLAY_PROPERTY } from "./inputMode";

interface Listener {
  readonly type: string;
  readonly listener: EventListener;
}

function mkSource(): { source: Parameters<typeof observeInputMode>[1]; listeners: Listener[] } {
  const listeners: Listener[] = [];
  const source = {
    addEventListener(type: string, listener: EventListener): void {
      listeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: EventListener): void {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return { source, listeners };
}

function mkRoot(): { root: Parameters<typeof observeInputMode>[0]; written: string[] } {
  const written: string[] = [];
  return {
    root: {
      style: {
        setProperty(property: string, value: string): void {
          if (property === ROW_ACTIONS_DISPLAY_PROPERTY) written.push(value);
        },
      },
    },
    written,
  };
}

// The module reads pointerType by shape, so a plain object stands in for a
// PointerEvent that happy-dom cannot construct with a pointerType.
function mkEvent(source: unknown): Event {
  const event = new Event("test");
  return Object.assign(event, source);
}

function send(listeners: readonly Listener[], type: string, event: unknown): void {
  for (const entry of listeners) {
    if (entry.type === type) entry.listener(mkEvent(event));
  }
}

describe("observeInputMode", () => {
  it("starts in mouse mode, so the action row exists before any input", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();

    observeInputMode(root, source);

    expect(written).toEqual(["flex"]);
    expect(listeners.map((entry) => entry.type)).toEqual(["pointerdown", "keydown"]);
  });

  it("removes the action row when a finger arrives", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    observeInputMode(root, source);

    send(listeners, "pointerdown", { pointerType: "touch" });

    expect(written).toEqual(["flex", "none"]);
  });

  it("returns the action row when the mouse comes back", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    observeInputMode(root, source);

    send(listeners, "pointerdown", { pointerType: "touch" });
    send(listeners, "pointerdown", { pointerType: "mouse" });

    expect(written).toEqual(["flex", "none", "flex"]);
  });

  it("treats a pen as a mouse, because a pen hovers", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    observeInputMode(root, source);

    send(listeners, "pointerdown", { pointerType: "touch" });
    send(listeners, "pointerdown", { pointerType: "pen" });

    expect(written).toEqual(["flex", "none", "flex"]);
  });

  it("keeps the action row for a keyboard user", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    observeInputMode(root, source);

    send(listeners, "pointerdown", { pointerType: "touch" });
    send(listeners, "keydown", { key: "Tab" });

    expect(written).toEqual(["flex", "none", "flex"]);
  });

  it("writes nothing when the input does not change", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    observeInputMode(root, source);

    send(listeners, "pointerdown", { pointerType: "touch" });
    send(listeners, "pointerdown", { pointerType: "touch" });
    send(listeners, "pointerdown", { pointerType: "touch" });

    expect(written).toEqual(["flex", "none"]);
  });

  it("stops the watch and removes both listeners", () => {
    const { source, listeners } = mkSource();
    const { root, written } = mkRoot();
    const stop = observeInputMode(root, source);

    stop();
    send(listeners, "pointerdown", { pointerType: "touch" });

    expect(listeners).toEqual([]);
    expect(written).toEqual(["flex"]);
  });
});
