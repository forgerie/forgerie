// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Excerpt } from "./Excerpt";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** happy-dom lays nothing out: give the cut box and its content the sizes a browser would. */
function sizes(content: number, box: number) {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(content);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(box);
}

describe("an excerpt", () => {
  it("offers Show more only when the content is cut, and opens it as a named region", async () => {
    sizes(400, 100);
    await act(async () => { root.render(<Excerpt label="Issue body"><p>Long text</p></Excerpt>); });
    const toggle = document.querySelector("button");
    const box = document.querySelector(".excerpt-box");
    expect(toggle?.textContent).toBe("Show more");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe(box?.id);
    expect(box?.hasAttribute("data-cut")).toBe(true);
    await act(async () => { toggle?.click(); });
    expect(toggle?.textContent).toBe("Show less");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(box?.getAttribute("role")).toBe("region");
    expect(box?.getAttribute("aria-label")).toBe("Issue body");
    expect(box?.hasAttribute("data-cut")).toBe(false);
    await act(async () => { toggle?.click(); });
    expect(toggle?.textContent).toBe("Show more");
  });

  it("shows short content whole, with no toggle", async () => {
    sizes(40, 100);
    await act(async () => { root.render(<Excerpt label="Issue body"><p>Short</p></Excerpt>); });
    expect(document.querySelector("button")).toBeNull();
    expect(document.querySelector(".excerpt-box")?.hasAttribute("data-cut")).toBe(false);
  });
});
