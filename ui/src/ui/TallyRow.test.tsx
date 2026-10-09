// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TallyRow, visibleMarks } from "./TallyRow";

describe("visibleMarks", () => {
  it("shows every mark up to the limit", () => {
    expect(visibleMarks(["plain", "bad"], 2)).toEqual({ shown: ["plain", "bad"] });
  });
  it("turns the tail into a count with the worst tone it hides", () => {
    expect(visibleMarks(["plain", "plain", "plain", "faint", "bad", "warn"], 4))
      .toEqual({ shown: ["plain", "plain", "plain"], more: { count: 3, tone: "bad" } });
    expect(visibleMarks(["plain", "plain", "live", "plain"], 3)).toEqual({ shown: ["plain", "plain"], more: { count: 2, tone: "live" } });
  });
});

describe("TallyRow", () => {
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders its panel only while open, and points the toggle at it", async () => {
    const panel = vi.fn(() => <p>detail</p>);
    await act(async () => root.render(<TallyRow marks={["plain"]} label="1 call" title="bash" panel={panel}><p>Text</p></TallyRow>));
    const toggle = document.querySelector<HTMLButtonElement>("button.tally-toggle")!;
    expect(toggle.getAttribute("aria-label")).toBe("1 call");
    expect(panel).not.toHaveBeenCalled();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toBe("bashdetail");
    await act(async () => toggle.click());
    expect(document.querySelector(".tally-panel")).toBeNull();
  });

  it("makes the quiet line part of the toggle when there is no content", async () => {
    await act(async () => root.render(<TallyRow marks={["live"]} live label="1 call" line="bash npm test" panel={() => null} />));
    const toggle = document.querySelector<HTMLButtonElement>("button.tally-toggle")!;
    expect(toggle.textContent).toBe("1 call: bash npm test");
    expect(toggle.querySelector(".tally-line")?.hasAttribute("data-live")).toBe(true);
    expect(document.querySelector(".tally-body")).toBeNull();
  });

  it("keeps a failure hidden in the tail visible on the count", async () => {
    await act(async () => root.render(<TallyRow marks={["plain", "plain", "plain", "bad"]} limit={3} label="4 calls" panel={() => null}><p>x</p></TallyRow>));
    expect(document.querySelectorAll(".tally-mark")).toHaveLength(2);
    const more = document.querySelector<HTMLElement>(".tally-more")!;
    expect(more.textContent).toBe("+2");
    expect(more.dataset["tone"]).toBe("bad");
  });
});
