import { describe, expect, it } from "vitest";
import { SESSION_FRAME_BYTES, SessionWireDecoder, sessionWireChunks } from "./sessionWire.js";

const payload = (text: string) => JSON.stringify({ type: "session.open", open: { text } });
const chunks = () => [...sessionWireChunks(payload("x".repeat(70_000)), "cut")];

describe("session wire cuts", () => {
  it("round-trips Unicode, escapes and surrogate pairs without changing the serialized cut", () => {
    const source = { type: "session.snapshot", text: "界🌍\u0000\n\\\"".repeat(40_000), id: "stable", seq: 7 };
    const frames = [...sessionWireChunks(JSON.stringify(source), "cut")];
    expect(frames.length).toBeGreaterThan(1);
    const decoder = new SessionWireDecoder();
    const received = frames.map(frame => {
      expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(SESSION_FRAME_BYTES);
      return decoder.read(frame);
    });
    expect(received.slice(0, -1).every(value => value === undefined)).toBe(true);
    expect(received.at(-1)).toEqual(source);
  });

  it("passes ordinary and interleaved host events through without exposing an incomplete cut", () => {
    const decoder = new SessionWireDecoder();
    const frames = chunks();
    expect(decoder.read(frames[0] ?? "")).toBeUndefined();
    const host = { type: "shell.chunk", chunk: "new output", seq: 9 };
    expect(decoder.read(JSON.stringify(host))).toEqual(host);
    expect(decoder.read(frames[1] ?? "")).toBeUndefined();
    expect(decoder.read(frames[2] ?? "")).toEqual(JSON.parse(payload("x".repeat(70_000))));
    expect(decoder.read(payload("next cut"))).toEqual({ type: "session.open", open: { text: "next cut" } });
  });

  it.each(["missing", "duplicate", "identity", "total", "length", "replacement"])("rejects a %s chunk instead of applying a partial cut", kind => {
    const decoder = new SessionWireDecoder();
    const frames = chunks();
    decoder.read(frames[0] ?? "");
    const second: unknown = JSON.parse(frames[1] ?? "");
    if (typeof second !== "object" || second === null) throw new Error("Expected a chunk object");
    const invalid = kind === "missing" ? frames[2] ?? ""
      : kind === "duplicate" ? frames[0] ?? ""
      : kind === "replacement" ? payload("newer cut")
      : JSON.stringify({ ...second, ...(kind === "identity" ? { id: "other" } : kind === "total" ? { total: 1 } : { data: "short" }) });
    expect(() => decoder.read(invalid)).toThrow();
  });

  it("starts fresh after a connection closes with an incomplete cut", () => {
    const decoder = new SessionWireDecoder();
    decoder.read(chunks()[0] ?? "");
    decoder.clear();
    expect(decoder.read([...sessionWireChunks(payload("reconnected"), "new")][0] ?? "")).toEqual({ type: "session.open", open: { text: "reconnected" } });
  });

  it("rejects a nonzero first index, malformed envelopes, and nested or non-cut payloads", () => {
    expect(() => new SessionWireDecoder().read(chunks()[1] ?? "")).toThrow();
    expect(() => new SessionWireDecoder().read(JSON.stringify({ type: "session.chunk", id: "cut", index: -1, total: 3, data: "abc" }))).toThrow();
    const decoder = new SessionWireDecoder();
    const host = [...sessionWireChunks(JSON.stringify({ type: "shell.chunk", chunk: "output" }), "cut")][0] ?? "";
    expect(() => decoder.read(host)).toThrow("not a session cut");
  });
});
