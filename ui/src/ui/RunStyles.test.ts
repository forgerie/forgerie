/**
 * The build list's components size from their container. Viewport units
 * belong to the page frame (AGENTS.md): a pane inside a sheet that measured
 * the screen would size its log by a device it cannot see.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHEETS = ["JobList.css", "RunDetail.css", "RunList.css", "RunRow.css", "StateMark.css", "WatchToggle.css"];
const VIEWPORT_UNIT = /(?<![\w-])\d*\.?\d+(?:[sld]?v(?:h|w|i|b|min|max))\b/gu;

describe("build list stylesheets", () => {
  it.each(SHEETS)("%s uses no viewport units", (sheet) => {
    const css = readFileSync(join(import.meta.dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css.match(VIEWPORT_UNIT) ?? []).toEqual([]);
  });

  it("finds a viewport unit when there is one", () => {
    expect("max-block-size: min(14rem, 35dvh);".match(VIEWPORT_UNIT)).toEqual(["35dvh"]);
  });
});
