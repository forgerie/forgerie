// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeSheetBody } from "./CodeSheetBody";
import { highlightCode } from "./highlightCode";

vi.mock("./highlightCode", async (original) => {
  const real = await original<typeof import("./highlightCode")>();
  return { highlightCode: vi.fn(real.highlightCode) };
});

let root: Root;
const source = 'const value = "<script>never execute</script>";';
async function render(code = source, language = "typescript", highlight = true) {
  await act(async () => root.render(<CodeSheetBody code={code} language={language} highlight={highlight} />));
  await act(async () => { await vi.dynamicImportSettled(); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  vi.mocked(highlightCode).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Code sheet rendering", () => {
  it("does not highlight unchanged source again on a parent render", async () => {
    await render();
    expect(highlightCode).toHaveBeenCalledTimes(1);
    const code = document.querySelector("code");
    await render();
    expect(highlightCode).toHaveBeenCalledTimes(1);
    expect(document.querySelector("code")).toBe(code);
  });

  it("keeps exact escaped source while streaming and highlights the final content", async () => {
    await render(source.slice(0, 15), "typescript", false);
    await render(source, "typescript", false);
    expect(highlightCode).not.toHaveBeenCalled();
    expect(document.querySelector("code")?.textContent).toBe(source);
    await render();
    expect(document.querySelector("code")?.textContent).toBe(source);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(document.querySelector("pre")?.getAttribute("tabindex")).toBe("0");
  });

  it("updates changed text and labels without retaining the previous highlight", async () => {
    await render();
    await render("FROM alpine:3.20", "dockerfile");
    expect(document.querySelector("code")?.textContent).toBe("FROM alpine:3.20");
    expect(document.querySelector(".hljs-keyword")?.textContent).toBe("FROM");
    await render("<script>plain</script>", "not-a-language");
    expect(document.querySelector("code")?.textContent).toBe("<script>plain</script>");
    expect(document.querySelector("code span")).toBeNull();
    expect(document.querySelector("pre")?.getAttribute("aria-label")).toBe("not-a-language code");
  });
});
