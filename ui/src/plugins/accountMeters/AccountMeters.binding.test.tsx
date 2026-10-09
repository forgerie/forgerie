// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAppSettings, type AppSettings } from "@shared/appPlugins";
import { accountMetersManifest } from "@shared/appPluginManifests";
import { AccountMetersShelf } from "./AccountMeters.binding";
import type { QuotaRead } from "./useQuota";
import type { RedeemOutcome, RedeemRequest } from "./redeemReset";

let root: Root;
let reads: string[];
let answer: () => Promise<unknown>;
let redeems: RedeemRequest[];
let redeemAnswer: () => Promise<RedeemOutcome>;
let ids: number;
const now = new Date("2026-10-09T04:00:00Z");
const read: QuotaRead = (endpoint) => { reads.push(endpoint); return answer(); };
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const settings = (stored: Record<string, unknown> = {}): AppSettings => resolveAppSettings(accountMetersManifest, stored);
async function render(value: AppSettings) {
  await act(async () => root.render(<AccountMetersShelf settings={value} read={read} clock={() => now}
    redeem={(endpoint, request) => { redeems.push(request); reads.push(`redeem ${endpoint}`); return redeemAnswer(); }}
    newRequestId={() => `id-${String(++ids)}`} />));
  await settle();
}
const payload = {
  version: 1, updatedAt: "2026-10-09T03:59:00Z",
  providers: [
    { id: "claude", name: "Claude", accounts: [{ email: "me@work.example", available: true, selected: true, priority: 100, windows: [
      { id: "five_hour", name: "Five-hour", usedPercent: 27, remainingPercent: 73, resetsAt: "2026-10-09T07:40:00Z" },
      { id: "seven_day", name: "Seven-day", usedPercent: 80, remainingPercent: 20, resetsAt: "2026-10-12T16:00:00Z" },
    ] }] },
    { id: "codex", name: "Codex", accounts: [
      { email: "a@example", available: true, selected: true, priority: 100, windows: [{ id: "seven_day", name: "Seven-day", usedPercent: 5, remainingPercent: 95, resetsAt: "2026-10-12T16:00:00Z" }] },
      { email: "b@example", available: true, selected: false, priority: 0, windows: [{ id: "seven_day", name: "Seven-day", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-16T04:00:00Z" }] },
    ] },
  ],
};
const lanes = () => [...document.querySelectorAll(".lane-grid-mark")].map((node) => node.getAttribute("aria-label"));
const header = () => document.querySelector<HTMLButtonElement>(".shelf-header")!;
const message = () => document.querySelector(".shelf-message")!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  reads = []; answer = () => Promise.resolve(payload);
  redeems = []; ids = 0; redeemAnswer = () => Promise.resolve({ kind: "spent", message: "Usage refilled." });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

describe("account meters", () => {
  it("reads the configured address and draws every account's bars, with their words for a screen reader", async () => {
    await render(settings({ endpoint: "http://127.0.0.1:8317/quota" }));
    expect(reads).toEqual(["http://127.0.0.1:8317/quota"]);
    expect(lanes()).toEqual([
      "Five-hour: 73% left, resets in 4h, 0 points ahead of an even spend.",
      "Seven-day: 20% left, resets in 4d, 30 points behind an even spend.",
      "Seven-day: 95% left, resets in 4d, 45 points ahead of an even spend.",
      "Seven-day: 100% left, resets in 7d, 0 points ahead of an even spend.",
    ]);
    expect([...document.querySelectorAll(".lane-grid-block[data-marked]")].map((node) => node.getAttribute("aria-label"))).toEqual(["a@example, routed"]);
    expect(document.querySelector(".figure[data-tone=bad]")!.textContent).toBe("↓4d");
  });
  it("hides the bars turned off in Settings", async () => {
    await render(settings({ five_hour: false }));
    expect(lanes()[0]).toMatch(/^Seven-day: 20%/u);
    expect(lanes()).toHaveLength(3);
  });
  it("names each service by its mark, with the name for hover and screen readers", async () => {
    await render(settings());
    const names = [...document.querySelectorAll(".lane-grid-name")];
    expect(names.map((node) => [node.getAttribute("title"), node.textContent, node.querySelector("svg.glyph") !== null])).toEqual([["Claude", "", true], ["Codex", "", true]]);
    expect([...document.querySelectorAll(".lane-grid-group")].map((node) => node.getAttribute("aria-label"))).toEqual(["Claude", "Codex"]);
  });
  it("closes to the header alone and remembers the choice", async () => {
    await render(settings());
    expect(header().getAttribute("aria-expanded")).toBe("true");
    await act(async () => header().click());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".shelf-body")).toBeNull();
    expect(lanes()).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await render(settings());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    await act(async () => header().click());
    expect(lanes()).toHaveLength(4);
  });
  it("says why there is nothing to draw, and retries on request", async () => {
    answer = () => Promise.reject(new Error("Cannot reach cliproxyapi.hummingbird-lake.ts.net."));
    await render(settings());
    expect(message().textContent).toBe("Cannot reach cliproxyapi.hummingbird-lake.ts.net.Retry");
    expect(message().getAttribute("role")).toBe("alert");
    answer = () => Promise.resolve(payload);
    await act(async () => message().querySelector("button")!.click()); await settle();
    expect(lanes()).toHaveLength(4);
  });
  it("fades an old reading and says how old it is, without alarm", async () => {
    answer = () => Promise.resolve({ ...payload, updatedAt: "2026-10-09T03:48:00Z" });
    await render(settings());
    expect(document.querySelector(".shelf-status")!.textContent).toBe("12m old");
    expect(document.querySelector(".lane-grid")!.hasAttribute("data-faded")).toBe(true);
  });
  describe("banked resets", () => {
    const withResets = {
      ...payload,
      providers: [
        { ...payload.providers[0]!, accounts: [{ ...payload.providers[0]!.accounts[0]!,
          resets: { expiresAt: ["2026-10-22T16:00:00Z"], clears: ["five_hour", "seven_day"], restartsWindows: false, applicableCount: 1 } }] },
        { ...payload.providers[1]!, accounts: [
          { ...payload.providers[1]!.accounts[0]!, resets: { expiresAt: ["2026-10-22T20:26:38Z", "2026-10-29T18:51:16Z"], restartsWindows: true, applicableCount: 0 } },
          payload.providers[1]!.accounts[1]!,
        ] },
      ],
    };
    const chips = () => [...document.querySelectorAll<HTMLButtonElement>(".lane-grid-act")];
    const dialog = () => document.querySelector<HTMLDialogElement>("dialog.wt-dialog");
    const confirm = () => dialog()!.querySelector<HTMLButtonElement>(".wt-primary")!;
    beforeEach(() => { answer = () => Promise.resolve(withResets); HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; }; });

    it("marks each account that has one, and spends nothing until the question is answered", async () => {
      await render(settings());
      expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
        "1 reset available, expires Oct 22. Use a reset…", "2 resets available, the first expires Oct 22. Use a reset…"]);
      await act(async () => chips()[0]!.click());
      expect(dialog()!.textContent).toContain("does not move");
      expect(redeems).toEqual([]);
      await act(async () => dialog()!.querySelector<HTMLButtonElement>(".wt-secondary")!.click());
      expect(dialog()).toBeNull();
      expect(redeems).toEqual([]);
    });
    it("spends one Claude reset through the router, then stops offering it", async () => {
      await render(settings({ endpoint: "https://router.example/quota" }));
      await act(async () => chips()[0]!.click());
      await act(async () => confirm().click()); await settle();
      expect(redeems).toEqual([{ provider: "claude", email: "me@work.example", requestId: "id-1", clockPolicy: "preserve" }]);
      expect(reads).toContain("redeem https://router.example/quota");
      expect(dialog()).toBeNull();
      // The router's reading still lists the spent reset until its next poll; the chip does not.
      expect(chips()).toHaveLength(1);
    });
    it("holds the button where the provider would refuse, and says why", async () => {
      await render(settings());
      await act(async () => chips()[1]!.click());
      expect(dialog()!.textContent).toContain("starts over now");
      expect(dialog()!.textContent).toContain("keeps these resets banked");
      expect(confirm().disabled).toBe(true);
    });
    it("asks about the same request after an uncertain answer, and starts afresh after a refusal", async () => {
      redeemAnswer = () => Promise.resolve({ kind: "uncertain", message: "The router answered HTTP 502 (unknown)." });
      await render(settings());
      await act(async () => chips()[0]!.click());
      await act(async () => confirm().click()); await settle();
      expect(dialog()!.textContent).toContain("may or may not be spent");
      expect(confirm().textContent).toBe("Check again");
      redeemAnswer = () => Promise.resolve({ kind: "refused", message: "The provider reports no applicable reset at this time." });
      await act(async () => confirm().click()); await settle();
      expect(dialog()!.textContent).toContain("Nothing was spent");
      redeemAnswer = () => Promise.resolve({ kind: "spent", message: "Usage refilled." });
      await act(async () => confirm().click()); await settle();
      expect(redeems.map((request) => request.requestId)).toEqual(["id-1", "id-1", "id-2"]);
      expect(dialog()).toBeNull();
    });
    it("takes no second press while the router answers", async () => {
      let finish: (outcome: RedeemOutcome) => void = () => {};
      redeemAnswer = () => new Promise((resolve) => { finish = resolve; });
      await render(settings());
      await act(async () => chips()[0]!.click());
      await act(async () => confirm().click());
      expect(confirm().disabled).toBe(true);
      expect(confirm().textContent).toBe("Using reset…");
      await act(async () => confirm().click());
      expect(redeems).toHaveLength(1);
      await act(async () => finish({ kind: "spent", message: "Usage refilled." })); await settle();
      expect(dialog()).toBeNull();
    });
  });
  it("refuses a payload it cannot read rather than drawing a guess", async () => {
    answer = () => Promise.resolve({ version: 2 });
    await render(settings());
    expect(message().textContent).toContain("cannot read");
  });
});
