// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Picker } from "./Picker";
import { createLocationResolver, rows, sections } from "../picker/board";
it("waits for pointer dwell, cancels a departing row, and prefetches keyboard focus immediately", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const now = Date.now();
  const all = rows({ sessions: [{ id: "a", cwd: "/work", modified: new Date(now).toISOString() }], statuses: {}, activities: {}, unread: new Set(), locate: createLocationResolver([], []), now });
  const onPrefetch = vi.fn(), onCancelPrefetch = vi.fn();
  try {
    await act(async () => root.render(<Picker view={{ connection: { type: "ready" }, machines: 1, archivedCount: 0, sections: sections(all, { grouping: "state", showArchived: false, now }) }}
      prefs={{ grouping: "state", showArchived: false, allPinned: false, collapsed: new Set() }} onPrefs={() => {}}
      actions={{ onSelect: () => {}, onRetry: () => {}, onPrefetch, onCancelPrefetch }} />));
    const row = document.querySelector('[data-session="a"]'); if (!row) throw new Error("No row");
    await act(async () => { row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); row.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 100)); });
    expect(onPrefetch).not.toHaveBeenCalled(); expect(onCancelPrefetch).toHaveBeenCalledTimes(1);
    await act(async () => { row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 100)); });
    expect(onPrefetch).toHaveBeenCalledTimes(1);
    await act(async () => row.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(onPrefetch).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); }
});
