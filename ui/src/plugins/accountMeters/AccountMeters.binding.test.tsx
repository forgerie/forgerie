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
    // A reset is spent from the sheet; the sidebar only flags that one is banked.
    const chips = () => [...document.querySelectorAll<HTMLButtonElement>("dialog.sheet-dialog .lane-grid-act")];
    const openSheet = () => act(async () => document.querySelector<HTMLElement>(".shelf .lane-grid-block")!.click());
    const dialog = () => document.querySelector<HTMLDialogElement>("dialog.wt-dialog");
    const confirm = () => dialog()!.querySelector<HTMLButtonElement>(".wt-primary")!;
    beforeEach(() => { answer = () => Promise.resolve(withResets); HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; }; });

    it("tints the service's mark in the sidebar while an account has one, and offers nothing to press there", async () => {
      await render(settings());
      expect(document.querySelectorAll(".shelf .lane-grid-act")).toHaveLength(0);
      expect([...document.querySelectorAll(".shelf .lane-grid-name")].map((node) => [node.getAttribute("data-tone"), node.getAttribute("title")])).toEqual([
        ["live", "Claude: 1 account has a reset banked"], ["live", "Codex: 1 account has a reset banked"]]);
      expect(document.querySelectorAll(".shelf .lane-grid-flag")).toHaveLength(0);
    });
    it("marks each account that has one, and spends nothing until the question is answered", async () => {
      await render(settings());
      await openSheet();
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
      await openSheet();
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
      await openSheet();
      await act(async () => chips()[1]!.click());
      expect(dialog()!.textContent).toContain("starts over now");
      expect(dialog()!.textContent).toContain("keeps these resets banked");
      expect(confirm().disabled).toBe(true);
    });
    it("asks about the same request after an uncertain answer, and starts afresh after a refusal", async () => {
      redeemAnswer = () => Promise.resolve({ kind: "uncertain", message: "The router answered HTTP 502 (unknown)." });
      await render(settings());
      await openSheet();
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
      await openSheet();
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
  describe("the detail sheet", () => {
    const sheet = () => document.querySelector<HTMLDialogElement>("dialog.sheet-dialog");
    const shelfBlocks = () => [...document.querySelectorAll<HTMLElement>(".shelf .lane-grid-block")];
    const captions = () => [...sheet()!.querySelectorAll(".lane-grid-caption")].map((node) => node.textContent);
    beforeEach(() => { HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; }; });

    it("leaves addresses out of the sidebar, and opens the sheet at the account pressed", async () => {
      await render(settings());
      expect(document.querySelectorAll(".shelf .lane-grid-caption")).toHaveLength(0);
      expect(sheet()).toBeNull();
      await act(async () => shelfBlocks()[2]!.click());
      expect(captions()).toEqual(["me@work.example", "a@example", "b@example"]);
      expect(sheet()!.querySelector(".lane-grid-block[data-chosen]")!.getAttribute("aria-label")).toBe("b@example");
      await act(async () => sheet()!.querySelector<HTMLButtonElement>('[aria-label="Close quota"]')!.click());
      expect(sheet()).toBeNull();
    });
    it("names each account's press for a keyboard and a screen reader", async () => {
      await render(settings());
      expect([...document.querySelectorAll(".shelf .lane-grid-open")].map((node) => node.getAttribute("aria-label")))
        .toEqual(["Quota details for me@work.example", "Quota details for a@example", "Quota details for b@example"]);
      await act(async () => document.querySelector<HTMLButtonElement>(".shelf .lane-grid-open")!.click());
      expect(sheet()!.querySelector(".lane-grid-block[data-chosen]")!.getAttribute("aria-label")).toBe("me@work.example");
    });
    it("shows the windows the sidebar hides", async () => {
      await render(settings({ five_hour: false }));
      expect(lanes()).toHaveLength(3);
      await act(async () => shelfBlocks()[0]!.click());
      expect([...sheet()!.querySelectorAll(".lane-grid-mark")].map((node) => node.getAttribute("aria-label")?.split(":")[0]))
        .toEqual(["Five-hour", "Seven-day", "Seven-day", "Seven-day"]);
    });
    it("reads again on request", async () => {
      await render(settings());
      await act(async () => shelfBlocks()[0]!.click());
      await act(async () => sheet()!.querySelector<HTMLButtonElement>('[aria-label="Read again"]')!.click()); await settle();
      expect(reads).toHaveLength(2);
    });
    it("asks about a reset over the sheet", async () => {
      answer = () => Promise.resolve({ ...payload, providers: [{ ...payload.providers[0]!, accounts: [{ ...payload.providers[0]!.accounts[0]!,
        resets: { expiresAt: ["2026-10-22T16:00:00Z"], clears: ["five_hour", "seven_day"], restartsWindows: false, applicableCount: 1 } }] }] });
      await render(settings());
      await act(async () => shelfBlocks()[0]!.click());
      await act(async () => sheet()!.querySelector<HTMLButtonElement>(".lane-grid-act")!.click());
      expect(sheet()).not.toBeNull();
      expect(document.querySelector("dialog.wt-dialog")!.textContent).toContain("does not move");
    });
    it("leaves an account out of service out of the sidebar, and shows it struck in the sheet", async () => {
      answer = () => Promise.resolve({ ...payload, providers: [payload.providers[0]!, { ...payload.providers[1]!, accounts: [
        ...payload.providers[1]!.accounts, { email: "off@example", available: false, selected: false, priority: 0, windows: [] }] }] });
      await render(settings());
      expect(shelfBlocks().map((node) => node.getAttribute("aria-label"))).toEqual(["me@work.example", "a@example, routed", "b@example"]);
      await act(async () => shelfBlocks()[0]!.click());
      expect(sheet()!.querySelector(".lane-grid-block[data-struck]")!.getAttribute("aria-label")).toBe("off@example, out of service");
    });
  });
  it("draws one-reading accounts side by side in the sidebar: a dot or an amount and its clock, with no lane", async () => {
    answer = () => Promise.resolve({ ...payload, providers: [
      { id: "antigravity", name: "Antigravity", accounts: [
        { email: "g@example", available: true, selected: false, priority: 0, windows: [
          { id: "antigravity_gemini", name: "Gemini", usedPercent: 100, remainingPercent: 0, resetsAt: "2026-10-09T23:00:00Z" }] },
        { email: "h@example", available: true, selected: true, priority: 0, windows: [
          { id: "antigravity_gemini", name: "Gemini", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-09T09:00:00Z" }] }] },
      { id: "openrouter", name: "OpenRouter", routing: "rotating", accounts: [{ email: "sk-or", available: true, selected: true, priority: 0, windows: [
        { id: "openrouter_credits", name: "Credits", usedPercent: 0, remainingPercent: 100, resetsAt: null, remainingAmount: 7.1 }] }] },
    ] });
    await render(settings());
    expect(document.querySelectorAll(".shelf .lane-grid-block")).toHaveLength(0);
    const tokens = [...document.querySelectorAll<HTMLElement>(".shelf .lane-grid-token")];
    // A refusing pool's clock says it cannot serve until it resets, as a dry lane's does.
    expect(tokens.map((node) => [node.getAttribute("aria-label"), node.textContent])).toEqual([["g@example, out of service", "↓19h"], ["h@example, routed", "5h"], ["sk-or", "$7"]]);
    expect(tokens[0]!.querySelector(".signal-dot[data-off]:not([data-run])")).not.toBeNull();
    expect(tokens[1]!.hasAttribute("data-marked")).toBe(true);
    // The sheet keeps the full drawing: the pool's dots across the lane and the balance's pips.
    await act(async () => tokens[0]!.click());
    expect(document.querySelector("dialog.sheet-dialog .lane-grid-block[data-chosen]")!.getAttribute("aria-label")).toBe("g@example, out of service");
    expect(document.querySelector("dialog.sheet-dialog .signal-dot[data-run][data-off]")).not.toBeNull();
    expect(document.querySelector<HTMLElement>("dialog.sheet-dialog .pip-run")!.style.getPropertyValue("--pips")).toBe("7");
  });
  it("refuses a payload it cannot read rather than drawing a guess", async () => {
    answer = () => Promise.resolve({ version: 2 });
    await render(settings());
    expect(message().textContent).toContain("cannot read");
  });
});
