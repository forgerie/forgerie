import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSessionHistoryPageSchema, createSessionOpenSchema, FIRST_PAGE_LIMIT, sessionOpenRequestSchema, type SessionOpenResponse } from "./sessionOpen.js";

const message = z.object({ role: z.string(), content: z.string().optional() });
const status = z.object({ isStreaming: z.boolean() });
const schema = createSessionOpenSchema(message, status);
const open: SessionOpenResponse<z.output<typeof message>, z.output<typeof status>> = {
  session: { id: "session", cwd: "/workspace" }, readPath: "classic", epoch: "daemon", seq: 12, historyId: "branch",
  page: { messages: [{ role: "user", content: "Last turn" }], start: 99, total: 100 },
  snapshot: { seq: 12, partial: null, tools: [], transientEvents: [] }, status: { isStreaming: false }, receipt: null,
};

describe("one-request open envelope", () => {
  it("accepts the same cut on both read paths and a conservatively captured receipt", () => {
    expect(schema.parse(open)).toEqual(open);
    expect(schema.parse({ ...open, readPath: "native", receipt: { catalogId: "catalog", throughCompletionOrder: 3 } }).receipt?.throughCompletionOrder).toBe(3);
  });
  it("refuses mixed watermarks", () => {
    expect(schema.safeParse({ ...open, snapshot: { ...open.snapshot, seq: 13 } }).success).toBe(false);
  });
  it.each([
    { start: -1, total: 100 }, { start: 101, total: 100 }, { start: 100, total: 100 },
    { start: 0.5, total: 100 }, { start: 0, total: Number.MAX_SAFE_INTEGER + 1 },
  ])("refuses impossible page positions %j", page => {
    expect(schema.safeParse({ ...open, page: { ...open.page, ...page } }).success).toBe(false);
  });
  it("allows safe-boundary expansion above 50 messages and around pages before the tail", () => {
    expect(schema.safeParse({ ...open, page: { messages: Array.from({ length: 54 }, () => ({ role: "user" })), start: 100, total: 200 } }).success).toBe(true);
  });
  it("requires an explicit receipt and forbids zero completion orders", () => {
    expect(schema.safeParse({ ...open, receipt: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...open, receipt: { catalogId: "catalog", throughCompletionOrder: 0 } }).success).toBe(false);
  });
  it("allows only synthesized host output in the transient seed", () => {
    const transientEvents = [{ type: "shell.start", command: "pwd" }, { type: "shell.chunk", chunk: "/workspace" },
      { type: "shell.end", exitCode: 0, fullOutputPath: "/workspace/output.txt" }, { type: "command.output", level: "info", message: "Done" }];
    expect(schema.parse({ ...open, snapshot: { ...open.snapshot, transientEvents } }).snapshot.transientEvents).toEqual(transientEvents);
    expect(schema.safeParse({ ...open, snapshot: { ...open.snapshot, transientEvents: [{ type: "pi.event", eventType: "message_start" }] } }).success).toBe(false);
  });
  it("uses each adapter's allowlist, without serializing private status/message fields", () => {
    const input = { ...open, status: { isStreaming: false, privateRecord: "secret" },
      page: { ...open.page, messages: [{ role: "user", privateProvider: "secret" }] } };
    const parsed = schema.parse(input);
    expect(parsed.status).toEqual({ isStreaming: false });
    expect(parsed.page.messages).toEqual([{ role: "user" }]);
  });
  it("validates older page metadata with the same position invariant", () => {
    const pageSchema = createSessionHistoryPageSchema(message);
    const page = { ...open.page, historyId: "branch", epoch: "daemon", seq: 12 };
    expect(pageSchema.parse(page)).toEqual(page);
    expect(pageSchema.safeParse({ ...page, start: 100 }).success).toBe(false);
  });
});

describe("open request boundary", () => {
  it("defaults to 50 projected messages and leaves around absent", () => {
    expect(sessionOpenRequestSchema.parse({ cwd: "/workspace" })).toEqual({ cwd: "/workspace", limit: FIRST_PAGE_LIMIT });
  });
  it.each([0, 501, 1.5, NaN, Infinity, "50"])("rejects invalid semantic limit %s", limit => {
    expect(sessionOpenRequestSchema.safeParse({ cwd: "/workspace", limit }).success).toBe(false);
  });
  it.each(["relative", "", "/workspace\0private"])("rejects invalid cwd %s", cwd => {
    expect(sessionOpenRequestSchema.safeParse({ cwd }).success).toBe(false);
  });
  it("requires a safe nonnegative around position", () => {
    expect(sessionOpenRequestSchema.safeParse({ cwd: "/workspace", around: -1 }).success).toBe(false);
    expect(sessionOpenRequestSchema.parse({ cwd: "/workspace", around: 0 }).around).toBe(0);
  });
});
