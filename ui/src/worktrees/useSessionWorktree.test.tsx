// @vitest-environment happy-dom
import { Activity, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createWorktreeApi } from "./worktreeApi";
import { useSessionWorktree } from "./useSessionWorktree";
import { related } from "../projectGroups/fixtures/groups";

it("keeps counts on healthy reveal, preserves explicit refresh, and adopts hidden catalog metadata", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const request = vi.fn(async () => Response.json({ error: "Git unavailable" }, { status: 503 }));
  const api = createWorktreeApi(request);
  const initial = related.related[0]; if (!initial) throw new Error("Missing worktree fixture");
  function View({ id, branch }: { id: string; branch: string }) {
    const worktree = useSessionWorktree(api, { catalog: { ...initial!, id, branch } }, false);
    return <button onClick={() => void worktree.refresh()}>{worktree.info?.branch}</button>;
  }
  const render = (visible: boolean, id = initial.id, branch = "main") => root.render(<Activity mode={visible ? "visible" : "hidden"}><View id={id} branch={branch} /></Activity>);
  try {
    await act(async () => render(true)); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => render(false)); await act(async () => render(true)); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => document.querySelector("button")?.click()); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => render(false, initial.id, "event-updated")); await act(async () => render(true, initial.id, "event-updated"));
    expect(document.querySelector("button")?.textContent).toBe("event-updated"); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => render(true, "other")); expect(request).toHaveBeenCalledTimes(3);
  } finally { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); }
});
