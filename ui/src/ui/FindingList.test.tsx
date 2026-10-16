// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingList } from "./FindingList";
import { FILE_CHECK_DELAY_MS, type FileLinks } from "./FileTree";

let root: Root;
const review = "verdict: changes needed\nnit src/ui.ts:40 — minor\nP1 src/app.ts:12,14–15 — wrong\n  fix: smallest fix\nP2 src/gone.ts:3 — missing file";
const onDisk = new Set(["src/app.ts", "src/ui.ts"]);
function links(open = vi.fn()) {
  const existing = vi.fn(async (paths: readonly string[]) => new Set(paths.filter((path) => onDisk.has(path))));
  return { existing, open } satisfies FileLinks;
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(FILE_CHECK_DELAY_MS); }); }
const opens = () => [...document.querySelectorAll<HTMLButtonElement>("button.finding-list-open")];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FindingList", () => {
  it("leads with the verdict and lists defects worst first", async () => {
    await act(async () => root.render(<FindingList code={review} />));
    expect(document.querySelector(".finding-list-verdict")!.textContent).toBe("Changes needed");
    expect([...document.querySelectorAll(".finding-list-pill")].map((pill) => pill.textContent)).toEqual(["P1", "P2", "Nit"]);
    expect(document.querySelector(".finding-list-summary")!.textContent).toBe("1 P1, 1 P2, 1 Nit");
  });

  it("opens a location's file once it is known to exist, without its line numbers", async () => {
    const fileLinks = links();
    await act(async () => root.render(<FindingList code={review} links={fileLinks} />));
    expect(opens()).toEqual([]);
    await settle();
    expect(fileLinks.existing).toHaveBeenCalledWith(["src/app.ts", "src/gone.ts", "src/ui.ts"], expect.anything());
    expect(opens().map((button) => button.title)).toEqual(["src/app.ts", "src/ui.ts"]);
    await act(async () => opens()[0]!.click());
    expect(fileLinks.open).toHaveBeenCalledWith("src/app.ts");
  });

  it("keeps every location plain without links", async () => {
    await act(async () => root.render(<FindingList code={review} />));
    await settle();
    expect(opens()).toEqual([]);
    expect(document.querySelectorAll(".finding-list-where")).toHaveLength(3);
  });
});
