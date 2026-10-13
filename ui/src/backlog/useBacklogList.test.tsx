// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useBacklogList } from "./useBacklogList";
import type { BacklogApi } from "./backlogApi";
it("keys reads by scope and never falls back to another scope's snapshot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); window.localStorage.clear();
  const calls: string[] = []; let failMine = false;
  const api: Pick<BacklogApi, "list"> = { list: async (_signal, scope = "mine") => { calls.push(scope); if (failMine && scope === "mine") throw new Error("offline"); return { items: [], warnings: [], sources: [], generatedAt: scope }; } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Screen() { const { scope, setScope, load } = useBacklogList(api); return <><button onClick={() => setScope(scope === "mine" ? "everyone" : "mine")}>Scope</button><p>{load.type === "ready" ? load.value.generatedAt : load.type === "failed" ? load.last?.generatedAt ?? "failed" : "loading"}</p></>; }
  const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  try {
    await act(async () => root.render(<Screen />)); await settle(); expect(host.querySelector("p")!.textContent).toBe("mine");
    await act(async () => host.querySelector("button")!.click()); await settle(); expect(host.querySelector("p")!.textContent).toBe("everyone");
    failMine = true; await act(async () => host.querySelector("button")!.click()); await settle();
    expect(host.querySelector("p")!.textContent).toBe("failed"); expect(calls).toEqual(["mine", "everyone", "mine"]);
  } finally { await act(async () => root.unmount()); host.remove(); window.localStorage.clear(); vi.unstubAllGlobals(); }
});
