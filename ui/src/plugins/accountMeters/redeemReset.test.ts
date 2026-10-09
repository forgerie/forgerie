import { afterEach, describe, expect, it, vi } from "vitest";
import { QUOTA_WITH_RESETS } from "./fixtures/quota";
import { newRequestId, redeemAddress, redeemOutcome, redeemReset, withoutSpent } from "./redeemReset";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
afterEach(() => { vi.unstubAllGlobals(); });

describe("redeemAddress", () => {
  it("puts the redeem path beside the quota address", () => {
    expect(redeemAddress("https://cliproxyapi.example.ts.net/quota")).toBe("https://cliproxyapi.example.ts.net/quota/resets/redeem");
    expect(redeemAddress("http://127.0.0.1:8317/quota/?x=1#y")).toBe("http://127.0.0.1:8317/quota/resets/redeem");
  });
});

describe("newRequestId", () => {
  it("makes a lowercase UUID v4, with or without randomUUID", () => {
    expect(newRequestId()).toMatch(UUID_V4);
    const bare = { getRandomValues: <T extends ArrayBufferView>(array: T) => { new Uint8Array(array.buffer).fill(0xff); return array; } } as unknown as Crypto;
    expect(newRequestId(bare)).toMatch(UUID_V4);
  });
});

describe("redeemOutcome", () => {
  it("counts a reset as spent only on a 200 that says so", () => {
    expect(redeemOutcome(200, { result: "reset", message: "Usage refilled." })).toEqual({ kind: "spent", message: "Usage refilled." });
    expect(redeemOutcome(200, { result: "already_used" }).kind).toBe("spent");
    expect(redeemOutcome(200, { result: "pending" }).kind).toBe("uncertain");
    expect(redeemOutcome(200, "not json").kind).toBe("uncertain");
  });
  it("treats a known refusal as nothing spent", () => {
    for (const result of ["not_limited", "cooldown", "ineligible", "origin_rejected", "request_conflict"]) {
      expect(redeemOutcome(result === "origin_rejected" ? 403 : 409, { result }).kind).toBe("refused");
    }
  });
  it("never reads a pending request, a 502, or an unknown result as success or refusal", () => {
    expect(redeemOutcome(409, { result: "pending" }).kind).toBe("uncertain");
    expect(redeemOutcome(502, { result: "unknown", message: "No answer." })).toEqual({ kind: "uncertain", message: "No answer." });
    expect(redeemOutcome(409, { result: "something_new" }).kind).toBe("uncertain");
  });
});

describe("redeemReset", () => {
  it("sends the router's exact contract and nothing else", async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ result: "reset" }), { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    const request = { provider: "claude", email: "me@work.example", requestId: "0b8c7d0e-6a1f-4c2b-9d3e-1f2a3b4c5d6e", clockPolicy: "preserve" as const };
    expect((await redeemReset("https://router.example/quota", request)).kind).toBe("spent");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://router.example/quota/resets/redeem");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Quota-Reset-Confirmation": "use-one-reset" });
    expect(JSON.parse(init.body as string)).toEqual({ ...request, confirm: true });
  });
  it("calls a lost connection uncertain, since the router may have had the request", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const outcome = await redeemReset("https://router.example/quota", { provider: "codex", email: "a", requestId: "x", clockPolicy: "restart" });
    expect(outcome).toEqual({ kind: "uncertain", message: "Cannot reach router.example." });
  });
});

describe("withoutSpent", () => {
  const read = new Date(QUOTA_WITH_RESETS.updatedAt).getTime();
  const team = (payload: typeof QUOTA_WITH_RESETS) => payload.providers.find((provider) => provider.id === "codex")!
    .accounts.find((account) => account.email === "team@example.com")!.resets;
  it("takes resets spent after the reading off, soonest first", () => {
    const after = withoutSpent(QUOTA_WITH_RESETS, { "codex/team@example.com": [read + 1000] });
    expect(team(after)?.expiresAt).toEqual(["2026-10-29T18:51:16Z", "2026-11-06T23:20:10Z"]);
  });
  it("trusts a reading taken after the spend", () => {
    expect(team(withoutSpent(QUOTA_WITH_RESETS, { "codex/team@example.com": [read - 1000] }))?.expiresAt).toHaveLength(3);
  });
  it("drops the marker when the last reset is spent", () => {
    const after = withoutSpent(QUOTA_WITH_RESETS, { "codex/team@example.com": [read + 1, read + 2, read + 3] });
    expect(team(after)).toBeUndefined();
  });
});
