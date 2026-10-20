// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodeSheetBody } from "./CodeSheetBody";

vi.mock("./highlightCode", () => { throw new Error("Fixture chunk unavailable"); });

it("keeps exact readable source and reports a shared optional-chunk failure once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(async () => root.render(<>
      <CodeSheetBody code={'<script>untrusted</script>'} language="html" />
      <CodeSheetBody code="let x = 1;" language="nix" />
    </>));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toBe("Code highlighting could not load; source remains readable.");
    expect([...document.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["<script>untrusted</script>", "let x = 1;"]);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelectorAll('pre[tabindex="0"]')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
