import { describe, expect, it } from "vitest";
import { appStyles } from "./shared";

const appCss = appStyles.cssText;

describe("PiWebApp viewport styles", () => {
  it("fits the measured visual viewport through the safe-area host", () => {
    expect(appCss).toMatch(/:host \{[^}]*height: var\(--pi-viewport-height, 100dvh\)/);
    expect(appCss).toMatch(/\.shell \{[^}]*height: 100%/);
    expect(appCss).not.toMatch(/\.shell \{[^}]*height: var\(--pi-viewport-height/);
  });
});
