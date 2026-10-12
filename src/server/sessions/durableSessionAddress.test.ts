import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { parseDurableSessionAddress } from "./durableSessionAddress.js";

it("validates filesystem locators without conflating logical and native identity", () => {
  const address = { journalId: "family", databasePath: "/tmp/state.sqlite", sessionId: "logical", conversationId: ROOT_CONVERSATION_ID };
  expect(parseDurableSessionAddress(address)).toEqual(address);
  for (const invalid of [null, { ...address, databasePath: "relative.sqlite" }, { ...address, databasePath: "/tmp/\u0000.sqlite" }, { ...address, conversationId: 1.5 }, { ...address, sessionId: "" }]) {
    expect(() => parseDurableSessionAddress(invalid)).toThrow("Invalid Durable session locator");
  }
});
