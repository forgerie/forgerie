import { describe, expect, it, vi } from "vitest";
import { SESSION_TABS_PER_SESSION_LIMIT } from "../../../shared/apiTypes";
import {
  LEGACY_SESSION_TABS_STORAGE_KEY,
  closedSessionTabs,
  promotedSessionTabs,
  reconciledMainView,
  removeLegacySessionTabsStorage,
  sessionTabsOf,
} from "./sessionTabs";

const FILES = "core:workspace.files";
const GIT = "core:workspace.git";
const TERMINAL = "core:workspace.terminal";

describe("sessionTabsOf", () => {
  it("reads the session's tabs and drops malformed ids", () => {
    expect(sessionTabsOf({ tabs: [GIT, "not a tool id", TERMINAL] })).toEqual([GIT, TERMINAL]);
  });

  it("treats a missing session or missing field as no tabs", () => {
    expect(sessionTabsOf(undefined)).toEqual([]);
    expect(sessionTabsOf({})).toEqual([]);
  });
});

describe("promotedSessionTabs", () => {
  it("appends a new tool at the end", () => {
    expect(promotedSessionTabs([GIT], TERMINAL)).toEqual([GIT, TERMINAL]);
  });

  it("keeps an already-promoted tool in place instead of duplicating it", () => {
    expect(promotedSessionTabs([GIT, TERMINAL], GIT)).toEqual([GIT, TERMINAL]);
  });

  it("refuses to grow past the per-session limit", () => {
    const full = Array.from({ length: SESSION_TABS_PER_SESSION_LIMIT }, (_, index) => `plugin:tool-${String(index)}`);
    expect(promotedSessionTabs(full, FILES)).toEqual(full);
  });
});

describe("closedSessionTabs", () => {
  it("removes the tool and keeps the others in order", () => {
    expect(closedSessionTabs([FILES, GIT, TERMINAL], GIT)).toEqual([FILES, TERMINAL]);
  });

  it("leaves an absent tool alone", () => {
    expect(closedSessionTabs([FILES], TERMINAL)).toEqual([FILES]);
  });
});

describe("reconciledMainView", () => {
  it("keeps chat and navigation regardless of tabs", () => {
    expect(reconciledMainView([], "chat")).toBe("chat");
    expect(reconciledMainView([], "navigation")).toBe("navigation");
  });

  it("keeps a tool view only while it is a tab", () => {
    expect(reconciledMainView([TERMINAL], TERMINAL)).toBe(TERMINAL);
    expect(reconciledMainView([GIT], TERMINAL)).toBe("chat");
    expect(reconciledMainView([], TERMINAL)).toBe("chat");
  });
});

describe("removeLegacySessionTabsStorage", () => {
  it("deletes the retired browser-local store", () => {
    const removeItem = vi.fn();
    removeLegacySessionTabsStorage({ removeItem });
    expect(removeItem).toHaveBeenCalledWith(LEGACY_SESSION_TABS_STORAGE_KEY);
  });

  it("tolerates unavailable storage", () => {
    expect(() => {
      removeLegacySessionTabsStorage({ removeItem: () => { throw new Error("denied"); } });
    }).not.toThrow();
  });
});
