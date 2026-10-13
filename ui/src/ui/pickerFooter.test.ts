import { expect, it } from "vitest";
import { footerPlan, FOOTER_ALL_LABELS, FOOTER_ICONS_ONLY } from "./pickerFooter";

it("keeps every word and Full screen inline from 25rem", () => {
  expect(footerPlan(FOOTER_ALL_LABELS)).toEqual({ placeLabels: true, settingsLabel: true, fullScreen: "inline" });
});
it("gives up Settings' word and moves Full screen into ⋯ one pixel under 25rem, down to 16.5rem", () => {
  expect(footerPlan(FOOTER_ALL_LABELS - 1)).toEqual({ placeLabels: true, settingsLabel: false, fullScreen: "menu" });
  expect(footerPlan(FOOTER_ICONS_ONLY)).toEqual({ placeLabels: true, settingsLabel: false, fullScreen: "menu" });
});
it("keeps only icons and counts one pixel under 16.5rem", () => {
  expect(footerPlan(FOOTER_ICONS_ONLY - 1)).toEqual({ placeLabels: false, settingsLabel: false, fullScreen: "menu" });
});
it("puts an 18rem list, the usual room, in the middle tier, and a 15rem docked list in the icon tier", () => {
  expect(footerPlan(271)).toEqual({ placeLabels: true, settingsLabel: false, fullScreen: "menu" });
  expect(footerPlan(15 * 16 - 17)).toEqual({ placeLabels: false, settingsLabel: false, fullScreen: "menu" });
});
