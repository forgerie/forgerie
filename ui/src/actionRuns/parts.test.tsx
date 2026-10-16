// @vitest-environment happy-dom
/**
 * The Actions parts are scenarios: their handlers work on local state
 * (ui/docs/decomposition.md, "Parts and Caliper"). Each one is pressed here
 * the way a reviewer would press it in Caliper.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as RunRowPart from "../ui/RunRow.molecule.part";
import * as RunListPart from "../ui/RunList.organism.part";
import * as RunDetailPart from "../ui/RunDetail.organism.part";
import * as ActionRunRowPart from "./ActionRunRow.molecule.part";
import * as PanelPart from "./ActionRunsPanel.organism.part";
import * as PullRunsPart from "./PullRunsSection.organism.part";

const PARTS = ["ui/RunRow.molecule.part.tsx", "ui/RunList.organism.part.tsx", "ui/RunDetail.organism.part.tsx",
  "actionRuns/ActionRunRow.molecule.part.tsx", "actionRuns/ActionRunsPanel.organism.part.tsx", "actionRuns/PullRunsSection.organism.part.tsx"];

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const show = async (State: ComponentType) => { await act(async () => root.render(<State />)); };
const press = async (element: Element | null | undefined) => {
  if (!element) throw new Error("Nothing to press.");
  await act(async () => { (element as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const button = (words: RegExp) => [...document.querySelectorAll("button")].find((item) => words.test(item.textContent ?? ""));
const text = () => document.body.textContent ?? "";
/** Unlink sits behind the row's ⋯ menu and asks twice when it would stop a watch. */
async function unlink() {
  await press(document.querySelector(".menu-button-trigger"));
  await press(button(/^Unlink/));
  const ask = button(/^Unlink it\?/);
  if (ask) await press(ask);
}

describe("Actions parts", () => {
  it("wire no empty handlers", () => {
    for (const part of PARTS) expect(readFileSync(join(import.meta.dirname, "..", part), "utf8"), part).not.toMatch(/\(\) => \{\}|async \(\) => false/u);
  });

  it("RunRow: the toggle flips, a press opens, and Unlink removes the row", async () => {
    await show(RunRowPart.Running);
    const toggle = document.querySelector(".watch-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    await press(toggle);
    expect(document.querySelector(".watch-toggle")?.getAttribute("aria-pressed")).toBe("true");
    await press(document.querySelector(".run-row-main"));
    expect(text()).toContain("Opened 1 time.");
    await unlink();
    expect(document.querySelector(".run-row")).toBeNull();
    expect(text()).toContain("Unlinked Build SM8550.");
  });

  it("RunList: a row opens, and Try again reads the runs in", async () => {
    await show(RunListPart.default);
    await press(document.querySelector(".run-row-main"));
    expect(document.querySelector(".run-row-note")?.textContent).toBe("Opened.");
    await show(RunListPart.Failed);
    await press(button(/^Try again$/));
    expect(document.querySelectorAll(".run-row")).toHaveLength(3);
  });

  it("RunDetail: the toggle flips, Back leaves, and Unlink removes the run", async () => {
    await show(RunDetailPart.Running);
    await press(document.querySelector(".watch-toggle"));
    expect(document.querySelector(".watch-toggle")?.getAttribute("aria-pressed")).toBe("false");
    await press(button(/^All runs$/));
    expect(text()).toContain("Back at the list of runs.");
    await press(button(/^Open run/));
    await press(document.querySelector(".run-detail-remove"));
    expect(document.querySelector(".run-detail")).toBeNull();
    expect(text()).toContain("Unlinked run");
  });

  it("ActionRunRow: the toggle flips, a press opens, and Unlink removes the row", async () => {
    await show(ActionRunRowPart.WatchedRunning);
    await press(document.querySelector(".watch-toggle"));
    expect(document.querySelector(".watch-toggle")?.textContent).toMatch(/^Watch again/u);
    await press(document.querySelector(".run-row-main"));
    expect(text()).toContain("Opened the jobs of run #4813.");
    await unlink();
    expect(document.querySelector(".run-row")).toBeNull();
    await show(ActionRunRowPart.ReadOnly);
    await press(document.querySelector(".run-row-main"));
    expect(text()).toContain("Opened the jobs of run #4812.");
  });

  it("Actions panel: a row opens its jobs, the toggle flips, and Unlink removes the row", async () => {
    await show(PanelPart.default);
    await press(document.querySelectorAll(".run-row .watch-toggle")[1]);
    expect(document.querySelectorAll(".run-row .watch-toggle")[1]?.textContent).toMatch(/^Watch again/u);
    await unlink();
    expect(document.querySelectorAll(".run-row")).toHaveLength(2);
    await press(document.querySelector(".run-row-main"));
    expect(document.querySelector(".run-detail-number")?.textContent).toBe("#4813");
  });

  it("Actions panel in place: the pull request panel's own handlers work too", async () => {
    await show(PanelPart.InPullRequestPanel);
    await press([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.startsWith("#142")));
    await press(button(/^Watch$/));
    expect(text()).toContain("Watching.");
    await press(document.querySelector('button[aria-label="Close pull request"]'));
    expect(document.querySelector("dialog")).toBeNull();
    await press(button(/^Open the pull request panel$/));
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("Runs under a pull request: watching one links it, and the Actions tab lists it", async () => {
    await show(PullRunsPart.UnderPullRequest);
    const codeql = [...document.querySelectorAll(".run-row")].find((row) => row.textContent?.includes("CodeQL"));
    await press(codeql?.querySelector(".watch-toggle"));
    await press([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Actions"));
    expect([...document.querySelectorAll(".run-row-name")].map((name) => name.textContent)).toContain("CodeQL");
  });
});
