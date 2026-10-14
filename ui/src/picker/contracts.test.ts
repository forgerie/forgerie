import { describe, expect, it } from "vitest";
import { parseCatalogEvent, unreadSchema } from "./contracts";

describe("optional picker receipt fields", () => {
  it("retains a complete validated receipt boundary", () => {
    expect(unreadSchema.parse({ catalogId: "epoch", sessions: [{ sessionId: "s", cwd: "/work", completionOrder: 7 }] })).toEqual({ catalogId: "epoch", sessions: [{ sessionId: "s", cwd: "/work", completionOrder: 7 }] });
  });
  it("keeps badge payloads valid without receipt fields or with only some fields", () => {
    expect(unreadSchema.parse({ sessions: [{ sessionId: "s" }] }).sessions).toEqual([{ sessionId: "s" }]);
    expect(parseCatalogEvent({ type: "sessions.unread", sessionId: "s", catalogId: "epoch", unread: {} })).toMatchObject({ sessionId: "s", catalogId: "epoch", unread: {} });
  });
  it("rejects unsafe receipt positions and relative working directories", () => {
    expect(unreadSchema.safeParse({ catalogId: "epoch", sessions: [{ sessionId: "s", cwd: "relative", completionOrder: 7 }] }).success).toBe(false);
    expect(unreadSchema.safeParse({ catalogId: "epoch", sessions: [{ sessionId: "s", cwd: "/work", completionOrder: Number.MAX_SAFE_INTEGER + 1 }] }).success).toBe(false);
  });
});
