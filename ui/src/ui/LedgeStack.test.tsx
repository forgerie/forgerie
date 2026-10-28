// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgeStack, type LedgeStackRow } from "./LedgeStack";
import { LedgeRow } from "./LedgeRow";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const row = (key: string, over: Partial<LedgeStackRow> = {}): LedgeStackRow => ({ key, kind: "Issue", title: `Title ${key}`, gist: `About ${key}`,
  actions: [{ label: "File", wideOnly: true, onPress: () => {} }, { label: "File and act", tone: "primary", onPress: () => {} }], ...over });
const labels = { noun: (count: number) => count === 1 ? "proposal" : "proposals", show: (count: number) => `Show all ${String(count)} proposals`, fold: "Fold" };
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name);

/** The host owns whether the list is open, as the session's ledge does. */
function Stack({ rows }: { rows: LedgeStackRow[] }) {
  const [open, setOpen] = useState(false);
  return <LedgeStack rows={rows} open={open} onToggle={() => setOpen(!open)} labels={labels} />;
}
const render = (rows: LedgeStackRow[]) => act(async () => root.render(<Stack rows={rows} />));

describe("a stack of offers", () => {
  it("shows one offer as its row with its gist, and no edges", async () => {
    await render([row("a")]);
    expect(document.querySelector("ul")?.getAttribute("aria-label")).toBe("1 proposal");
    expect(document.querySelector(".ledge-row-gist")?.textContent).toBe("About a");
    expect(document.querySelector("[data-ledge-edges]")).toBeNull();
  });

  it("folds two or more with the newest in front, its own actions, a count, and two edges at most", async () => {
    await render([row("c"), row("b"), row("a")]);
    expect([...document.querySelectorAll(".ledge-row-title")].map((node) => node.textContent)).toEqual(["Title c"]);
    expect(document.querySelector(".ledge-row-gist")).toBeNull();
    expect(button("File and act")?.getAttribute("data-tone")).toBe("primary");
    expect(document.querySelectorAll(".ledge-stack-edge")).toHaveLength(2);
    await render([row("b"), row("a")]);
    expect(document.querySelectorAll(".ledge-stack-edge")).toHaveLength(1);
    await render(Array.from({ length: 30 }, (_, index) => row(String(index))));
    expect(document.querySelectorAll(".ledge-stack-edge")).toHaveLength(2);
    expect(button("Show all 30 proposals")?.textContent).toBe("30");
  });

  it("opens to a counted list, newest first, where every row keeps its action and none is louder, and folds back with focus kept", async () => {
    await render([row("c"), row("b"), row("a")]);
    const count = button("Show all 3 proposals")!;
    expect(count.getAttribute("aria-expanded")).toBe("false");
    count.focus();
    await act(async () => count.click());
    expect(document.querySelector(".ledge-stack-head")?.textContent).toBe("3 proposalsFold");
    expect([...document.querySelectorAll(".ledge-row-title")].map((node) => node.textContent)).toEqual(["Title c", "Title b", "Title a"]);
    expect([...document.querySelectorAll(".ledge-row")].every((node) => node.hasAttribute("data-even"))).toBe(true);
    expect(document.querySelectorAll("button[data-tone='primary']")).toHaveLength(3);
    expect(document.activeElement).toBe(button("Fold"));
    expect(button("Fold")?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => button("Fold")!.click());
    expect(document.activeElement).toBe(button("Show all 3 proposals"));
  });
});

describe("a row", () => {
  it("moves its wide-only actions into More on a narrow row, ahead of the rest", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 300 } as DOMRect);
    const filed = vi.fn();
    await act(async () => root.render(<ul><LedgeRow kind="Issue" title="T" actions={[{ label: "File", wideOnly: true, onPress: filed },
      { label: "File and act", tone: "primary", onPress: () => {} }]} menuLabel="More for T" menu={[{ label: "Dismiss", onSelect: () => {} }]} /></ul>));
    expect(button("File")).toBeUndefined();
    await act(async () => button("More for T")!.click());
    expect([...document.querySelectorAll("[role='menuitem']")].map((node) => node.textContent)).toEqual(["File", "Dismiss"]);
    await act(async () => document.querySelector<HTMLButtonElement>("[role='menuitem']")!.click());
    expect(filed).toHaveBeenCalledOnce();
  });

  it("puts work in flight in place of its actions, and a failure's reason in place of its gist", async () => {
    await act(async () => root.render(<ul><LedgeRow kind="Backlog" title="T" gist="About" problem="Not filed: the folder is read-only."
      status={{ text: "Filing and starting…", tone: "live" }} actions={[{ label: "Retry", tone: "primary", onPress: () => {} }]} /></ul>));
    expect(document.querySelector("[role='status']")?.textContent).toBe("Filing and starting…");
    expect(button("Retry")).toBeUndefined();
    expect(document.querySelector(".ledge-row-gist")).toBeNull();
    expect(document.querySelector(".ledge-row-problem")?.textContent).toBe("Not filed: the folder is read-only.");
  });
});
