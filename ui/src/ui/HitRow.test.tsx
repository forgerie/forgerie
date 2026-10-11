// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { HitRow } from "./HitRow";
import { MARK_LEAD } from "./markRanges";

describe("hit row", () => {
  it("shows a late mark at the start of the passage, inside even a one-line clamp", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const passage = `${"Restarted forgerie-web.service and forgerie-sessiond.service, and both report active. ".repeat(4).slice(0, 220)} then the deploy log`;
    expect(passage.length).toBe(240);
    const at = passage.indexOf("deploy");
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(<HitRow title="Fix the deploy" where="forgerie" time="2h" speaker="You" passage={passage} marks={[[at, at + 6]]} onPress={() => {}} />));
    const shown = host.querySelector(".hit-row-passage")!.textContent!;
    const mark = host.querySelector(".hit-row-mark")!;
    expect(mark.textContent).toBe("deploy");
    // "You: …" and at most MARK_LEAD characters come before the mark.
    expect(shown.startsWith("You: …")).toBe(true);
    expect(Array.from(shown.slice(0, shown.indexOf("deploy"))).length).toBeLessThanOrEqual("You: …".length + MARK_LEAD);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});
