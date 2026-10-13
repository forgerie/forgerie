// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRunSheet } from "./WorkflowRunSheet";
import { RETRY_LOOKS, RUN_NOW, UNSENT } from "./fixtures/runs";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const track = (name: string) => [...document.querySelectorAll(".route-map-track")].find((node) => node.querySelector(".route-map-track-name")?.textContent === name);

describe("the run sheet", () => {
  it("shows a worker's retry in the warn notice, and unsent reports as plain lines", async () => {
    const onOpenChild = vi.fn();
    await act(async () => root.render(<WorkflowRunSheet run={UNSENT} workers={RETRY_LOOKS} onOpenChild={onOpenChild} onClose={() => {}} now={() => RUN_NOW} />));
    expect(track("design")?.querySelector(".route-map-track-notice")?.textContent).toMatch(/^Retrying 2 of 3: 529 /u);
    expect(track("design")?.textContent).toContain("Next try in 1 min 40 s");
    // Neither reason is drawn as trouble: no notice, only the track's quiet lines.
    for (const [name, line] of [["build", "Duplicate report, not sent again"], ["docs", "Stopped before reporting"]] as const) {
      expect(track(name)?.querySelector(".route-map-track-notice")).toBeNull();
      expect([...track(name)!.querySelectorAll(".route-map-track-line")].map((node) => node.textContent)).toContain(line);
    }
    await act(async () => { track("design")?.querySelector("button")?.click(); });
    expect(onOpenChild).toHaveBeenCalledWith("design");
  });
});
