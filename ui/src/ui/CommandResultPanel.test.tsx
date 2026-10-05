// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandResultPanel } from "./CommandResultPanel";
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe("Pi command follow-up", () => {
  it("responds with the request and option identity, and prevents duplicate choices while sending", async () => {
    const onChoose = vi.fn(); const onClose = vi.fn();
    const result = { type: "select" as const, requestId: "fork-1", title: "Fork from", options: [{ value: "entry-1", label: "Original question" }] };
    await act(async () => root.render(<CommandResultPanel result={result} disabled={false} onChoose={onChoose} onClose={onClose} />));
    await act(async () => document.querySelector<HTMLButtonElement>(".command-option")!.click());
    expect(onChoose).toHaveBeenCalledWith("fork-1", "entry-1");
    await act(async () => root.render(<CommandResultPanel result={result} disabled onChoose={onChoose} onClose={onClose} />));
    expect([...document.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  });
  it("shows command feedback without inventing transcript content and closes it", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<CommandResultPanel result={{ type: "done", message: "Stats\nTokens: 12" }} disabled={false} onChoose={() => {}} onClose={onClose} />));
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Stats\nTokens: 12");
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector(".message")).toBeNull();
  });
  it("leaves a tree to the session tree navigator", async () => {
    await act(async () => root.render(<CommandResultPanel result={{ type: "tree", tree: {
      nodes: [{ id: "a", parentId: null, kind: "user", summary: "First question" }], activeLeafId: "a", activePathIds: ["a"],
    } }} disabled={false} onChoose={() => {}} onClose={() => {}} />));
    expect(document.querySelector(".command-result")).toBeNull();
  });
});
