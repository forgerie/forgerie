import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { ModelChainsSchema, MAX_MODEL_CHAIN_LENGTH } from "../../shared/modelChains.js";
import { childRequestId, latestChildRequest, MAX_CHILD_ATTEMPT } from "./childRequestIds.js";

const lookupFrom = (admitted: Record<string, string>) => (requestId: string) => Promise.resolve(admitted[requestId]);

describe("child request IDs", () => {
  it("keeps the original and retry request formats", () => {
    expect(childRequestId(7, 0)).toBe("child:7");
    expect(childRequestId(7, 5)).toBe("child:7:retry:5");
  });

  it("recovers the latest attempt of a model chain beyond the legacy budget of 3", async () => {
    const admitted = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((attempt) => [childRequestId(9, attempt), `attempt ${String(attempt)}`]));
    expect(await latestChildRequest(9, lookupFrom(admitted))).toBe("attempt 6");
  });

  it("finds the latest attempt when the reporter started in a retry phase or a switch left a gap", async () => {
    const admitted = { [childRequestId(4, 1)]: "first", [childRequestId(4, 2)]: "second", [childRequestId(4, 5)]: "after gap" };
    expect(await latestChildRequest(4, lookupFrom(admitted))).toBe("after gap");
  });

  it("returns undefined when nothing was admitted and ignores other reporters", async () => {
    expect(await latestChildRequest(1, lookupFrom({ [childRequestId(2, 0)]: "other" }))).toBeUndefined();
  });

  it("probes a bounded number of attempts", async () => {
    let probes = 0;
    await latestChildRequest(1, () => { probes++; return Promise.resolve(undefined); });
    expect(probes).toBe(MAX_CHILD_ATTEMPT + 1);
  });

  it("caps chain length so every chain attempt stays within the probe bound", () => {
    const spec = "provider/model";
    expect(2 * MAX_MODEL_CHAIN_LENGTH + 3).toBeLessThanOrEqual(MAX_CHILD_ATTEMPT);
    expect(Check(ModelChainsSchema, { long: Array.from({ length: MAX_MODEL_CHAIN_LENGTH }, () => spec) })).toBe(true);
    expect(Check(ModelChainsSchema, { long: Array.from({ length: MAX_MODEL_CHAIN_LENGTH + 1 }, () => spec) })).toBe(false);
  });
});
