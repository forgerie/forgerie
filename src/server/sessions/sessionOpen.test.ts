import { describe, expectTypeOf, it } from "vitest";
import type { SessionStatus } from "../../shared/apiTypes.js";
import type { SessionOpenReceipt, SessionOpenTransientEvent } from "../../shared/sessionOpen.js";
import type { SessionOpenHistoryPage, SessionOpenMessage, SessionOpenReader, SessionOpenResult } from "./sessionOpen.js";

describe("server open type boundary", () => {
  it("binds the shared schema to projected browser messages and server status", () => {
    expectTypeOf<SessionOpenResult["status"]>().toEqualTypeOf<SessionStatus>();
    expectTypeOf<SessionOpenResult["page"]["messages"]>().toEqualTypeOf<SessionOpenMessage[]>();
    expectTypeOf<SessionOpenResult["receipt"]>().toEqualTypeOf<SessionOpenReceipt | null>();
    expectTypeOf<SessionOpenResult["snapshot"]["transientEvents"]>().toEqualTypeOf<SessionOpenTransientEvent[]>();
    expectTypeOf<SessionOpenHistoryPage["messages"]>().toEqualTypeOf<SessionOpenMessage[]>();
    expectTypeOf<ReturnType<SessionOpenReader["open"]>>().toEqualTypeOf<Promise<SessionOpenResult>>();
  });
});
