// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateCheck } from "../appUpdate";
import { AppUpdateNotice, UPDATE_POLL_MS } from "./AppUpdateNotice";

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** A deployment whose answers the test sets, counting each check. */
function deployment(first: UpdateCheck) {
  let answer = first;
  const asked: string[] = [];
  return { asked, set: (next: UpdateCheck) => { answer = next; }, check: (running: string) => { asked.push(running); return Promise.resolve(answer); } };
}
const notice = () => document.querySelector(".app-update");
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS); });

describe("app update notice", () => {
  it("offers a refresh once a different build is deployed, and reloads only when asked", async () => {
    const deployed = deployment({ type: "current" });
    const reload = vi.fn();
    await act(async () => root.render(<AppUpdateNotice running="index-a.js" check={deployed.check} reload={reload} />));
    await tick();
    expect(notice()).toBeNull();
    deployed.set({ type: "available", entry: "index-b.js" });
    await tick();
    expect(notice()?.textContent).toContain("A new version of Forgerie is ready.");
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Refresh")?.click(); });
    expect(reload).toHaveBeenCalledOnce();
    expect(deployed.asked.every((running) => running === "index-a.js")).toBe(true);
  });

  it("stays quiet when dismissed until yet another build arrives", async () => {
    const deployed = deployment({ type: "available", entry: "index-b.js" });
    await act(async () => root.render(<AppUpdateNotice running="index-a.js" check={deployed.check} />));
    await tick();
    await act(async () => { document.querySelector<HTMLButtonElement>("[aria-label='Not now']")?.click(); });
    await tick();
    expect(notice()).toBeNull();
    deployed.set({ type: "available", entry: "index-c.js" });
    await tick();
    expect(notice()).not.toBeNull();
  });

  it("keeps the offer through a failed check, and never checks without a running build", async () => {
    const deployed = deployment({ type: "available", entry: "index-b.js" });
    await act(async () => root.render(<AppUpdateNotice running="index-a.js" check={deployed.check} />));
    await tick();
    deployed.set({ type: "unknown" });
    await tick();
    expect(notice()).not.toBeNull();
    const dev = deployment({ type: "available", entry: "index-b.js" });
    await act(async () => root.render(<AppUpdateNotice running={undefined} check={dev.check} />));
    await tick();
    expect(dev.asked).toEqual([]);
    expect(notice()).toBeNull();
  });

  it("checks again as soon as the app comes back into view", async () => {
    const deployed = deployment({ type: "available", entry: "index-b.js" });
    await act(async () => root.render(<AppUpdateNotice running="index-a.js" check={deployed.check} />));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    expect(deployed.asked).toHaveLength(1);
    expect(notice()).not.toBeNull();
  });
});
