import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SessionEventHub, type RealtimeSocket } from "./sessionEventHub.js";

class RecordingSocket extends EventEmitter implements RealtimeSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: string[] = [];
  constructor(readonly failSend = false) { super(); }
  send(payload: string): void { if (this.failSend) throw new Error("closed"); this.sent.push(payload); }
  terminate(): void { this.readyState = 3; this.emit("close"); }
}

describe("event hub connection ownership", () => {
  it("releases 1000 closed session buckets while keeping reconnect watermarks", () => {
    const hub = new SessionEventHub();
    for (let index = 0; index < 1000; index++) {
      const socket = new RecordingSocket();
      const id = String(index);
      hub.add(id, socket);
      hub.publish(id, { type: "assistant.delta", text: "one" });
      socket.terminate();
    }
    expect(hub.diagnostics()).toMatchObject({ socketSessions: 0, sessionSockets: 0, globalSockets: 0, sequenceSessions: 1000 });
    const replacement = new RecordingSocket();
    hub.add("0", replacement);
    hub.publish("0", { type: "assistant.delta", text: "two" });
    expect(JSON.parse(replacement.sent[0] ?? "null")).toMatchObject({ seq: 2 });
  });
  it("a late repeated close cannot remove a replacement bucket", () => {
    const hub = new SessionEventHub();
    const old = new RecordingSocket();
    hub.add("one", old); old.terminate();
    const replacement = new RecordingSocket();
    hub.add("one", replacement); old.emit("close");
    expect(hub.diagnostics()).toMatchObject({ socketSessions: 1, sessionSockets: 1 });
    hub.publish("one", { type: "assistant.delta", text: "new" });
    expect(replacement.sent).toHaveLength(1);
    replacement.terminate();
    expect(hub.diagnostics()).toMatchObject({ socketSessions: 0, sessionSockets: 0 });
  });
  it("drops empty buckets after failed delivery and disposes host listeners", () => {
    const hub = new SessionEventHub();
    hub.add("one", new RecordingSocket(true));
    const stop = hub.observeHostState("one", () => { /* measured ownership only */ });
    expect(hub.diagnostics()).toMatchObject({ hostObservers: 1 });
    hub.publish("one", { type: "assistant.delta", text: "one" });
    stop(); stop();
    expect(hub.diagnostics()).toMatchObject({ socketSessions: 0, sessionSockets: 0, hostObservers: 0 });
  });
});
