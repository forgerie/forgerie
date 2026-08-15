import { describe, expect, it } from "vitest";
import { sessionInboxAttention } from "./sessionInboxAttention";

describe("sessionInboxAttention", () => {
  it("returns no attention when the inbox has neither blocked nor unread sessions", () => {
    expect(sessionInboxAttention({ blocked: 0, unread: 0 })).toBeUndefined();
  });

  it("returns unread when unread sessions are waiting", () => {
    expect(sessionInboxAttention({ blocked: 0, unread: 2 })).toBe("unread");
  });

  it("gives blocked sessions priority over unread sessions", () => {
    expect(sessionInboxAttention({ blocked: 1, unread: 2 })).toBe("blocked");
  });
});
