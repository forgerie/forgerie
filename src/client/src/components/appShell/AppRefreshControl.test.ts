// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRefreshControl } from "./AppRefreshControl";

afterEach(() => {
  document.body.replaceChildren();
});

describe("AppRefreshControl", () => {
  it("renders an accessible reload button and invokes the callback", async () => {
    const parentClick = vi.fn();
    const onReload = vi.fn();
    const parent = document.createElement("div");
    parent.addEventListener("click", parentClick);
    const control = new AppRefreshControl();
    control.onReload = onReload;
    parent.append(control);
    document.body.append(parent);
    await control.updateComplete;

    const button = control.shadowRoot?.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("Full page reload");
    expect(button?.getAttribute("title")).toBe("Full page reload");
    expect(control.shadowRoot?.querySelector("svg.app-refresh-icon")).not.toBeNull();

    button?.click();

    expect(onReload).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("allows a click when no reload callback is configured", async () => {
    const control = new AppRefreshControl();
    document.body.append(control);
    await control.updateComplete;

    expect(() => { control.shadowRoot?.querySelector<HTMLButtonElement>("button")?.click(); }).not.toThrow();
  });
});
