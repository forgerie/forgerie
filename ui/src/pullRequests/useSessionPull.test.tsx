// @vitest-environment happy-dom
import { Activity, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createPullRequestApi } from "./pullRequestApi";
import { useSessionPulls } from "./useSessionPull";

it("retains a healthy pull read across Activity reveal, but reads changed inputs and explicit refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const request = vi.fn(async () => Response.json({ items: [] }));
  const api = createPullRequestApi(request), lifetime = new AbortController();
  function View({ id }: { id: string }) {
    const pull = useSessionPulls(api, { id, cwd: "/work" }, [], lifetime.signal);
    return <button onClick={pull.refresh}>{pull.load.type}</button>;
  }
  const render = (visible: boolean, id = "a") => root.render(<Activity mode={visible ? "visible" : "hidden"}><View id={id} /></Activity>);
  try {
    await act(async () => render(true)); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => render(false)); await act(async () => render(true)); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => render(true, "b")); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => document.querySelector("button")?.click()); expect(request).toHaveBeenCalledTimes(3);
  } finally { lifetime.abort(); await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); }
});
