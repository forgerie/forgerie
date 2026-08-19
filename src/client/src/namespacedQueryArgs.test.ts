// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryNamespace, readNamespacedQuery, readNamespacedString, setNamespacedQueryKey } from "./namespacedQueryArgs";

beforeEach(() => {
  window.history.replaceState({}, "", "/app?other=keep#anchor");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("namespaced query arguments", () => {
  it("qualifies contribution ids for query keys", () => {
    expect(queryNamespace("core:workspace:git")).toBe("core.workspace.git");
  });

  it("reads only matching keys and preserves repeated values", () => {
    window.history.replaceState({}, "", "/app?core.git--path=a&other=x&core.git--path=b&core.git--empty=");

    expect(readNamespacedQuery("core.git")).toEqual({ path: ["a", "b"], empty: "" });
    expect(readNamespacedString("core.git", "path")).toBe("a");
    expect(readNamespacedString("core.git", "empty")).toBeUndefined();
    expect(readNamespacedString("core.git", "missing")).toBeUndefined();
  });

  it("pushes scalar and repeated values without disturbing other URL parts", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    setNamespacedQueryKey("core.git", "path", "src/app.ts");
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toContain("other=keep");
    expect(window.location.search).toContain("core.git--path=src%2Fapp.ts");
    expect(window.location.hash).toBe("#anchor");

    setNamespacedQueryKey("core.git", "path", ["one", 2, true]);
    expect(new URLSearchParams(window.location.search).getAll("core.git--path")).toEqual(["one", "2", "true"]);
    expect(pushState).toHaveBeenCalledTimes(2);
  });

  it("replaces, deletes, and skips unchanged URLs", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");

    setNamespacedQueryKey("core.git", "path", "src/app.ts", { replace: true });
    expect(replaceState).toHaveBeenCalledOnce();

    replaceState.mockClear();
    setNamespacedQueryKey("core.git", "path", "src/app.ts", { replace: true });
    expect(replaceState).not.toHaveBeenCalled();

    setNamespacedQueryKey("core.git", "path", null);
    expect(new URLSearchParams(window.location.search).has("core.git--path")).toBe(false);
    expect(pushState).toHaveBeenCalledOnce();

    pushState.mockClear();
    setNamespacedQueryKey("core.git", "path", "");
    expect(pushState).not.toHaveBeenCalled();
  });
});
