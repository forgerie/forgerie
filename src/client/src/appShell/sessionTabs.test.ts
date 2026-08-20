import { describe, expect, it } from "vitest";
import {
  NO_SESSION_TABS,
  SESSION_TABS_STORAGE_KEY,
  closeSessionTab,
  promoteSessionTab,
  readStoredSessionTabs,
  reconciledMainView,
  sessionTabsFor,
  writeStoredSessionTabs,
} from "./sessionTabs";

const SESSION_A = "local:session-a";
const SESSION_B = "local:session-b";
const TERMINAL = "core:workspace.terminal" as const;
const GIT = "core:workspace.git" as const;

describe("promoteSessionTab", () => {
  it("adds a tool to the session's tabs in promotion order", () => {
    const tabs = promoteSessionTab(promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL), SESSION_A, GIT);
    expect(sessionTabsFor(tabs, SESSION_A)).toEqual([TERMINAL, GIT]);
  });

  it("keeps one tab per tool: promoting again is a no-op", () => {
    const once = promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL);
    const twice = promoteSessionTab(once, SESSION_A, TERMINAL);
    expect(twice).toBe(once);
  });

  it("scopes tabs to the session that promoted them", () => {
    const tabs = promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL);
    expect(sessionTabsFor(tabs, SESSION_B)).toEqual([]);
  });
});

describe("closeSessionTab", () => {
  it("removes the tool and keeps the session's other tabs", () => {
    const tabs = promoteSessionTab(promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL), SESSION_A, GIT);
    expect(sessionTabsFor(closeSessionTab(tabs, SESSION_A, TERMINAL), SESSION_A)).toEqual([GIT]);
  });

  it("drops the session entry when the last tab closes", () => {
    const tabs = promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL);
    expect(closeSessionTab(tabs, SESSION_A, TERMINAL)).toEqual({});
  });

  it("is a no-op for a tool that was never promoted", () => {
    const tabs = promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL);
    expect(closeSessionTab(tabs, SESSION_A, GIT)).toBe(tabs);
  });
});

describe("reconciledMainView", () => {
  const tabs = promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL);

  it("keeps chat and navigation untouched", () => {
    expect(reconciledMainView(tabs, SESSION_A, "chat")).toBe("chat");
    expect(reconciledMainView(tabs, SESSION_A, "navigation")).toBe("navigation");
  });

  it("keeps a tool that is one of the session's tabs", () => {
    expect(reconciledMainView(tabs, SESSION_A, TERMINAL)).toBe(TERMINAL);
  });

  it("falls back to chat for a tool the session never promoted", () => {
    expect(reconciledMainView(tabs, SESSION_B, TERMINAL)).toBe("chat");
    expect(reconciledMainView(tabs, SESSION_A, GIT)).toBe("chat");
  });

  it("falls back to chat when no session is selected", () => {
    expect(reconciledMainView(tabs, undefined, TERMINAL)).toBe("chat");
  });
});

describe("stored session tabs", () => {
  it("round-trips through storage", () => {
    const written = new Map<string, string>();
    const storage = {
      getItem: (key: string) => written.get(key) ?? null,
      setItem: (key: string, value: string) => { written.set(key, value); },
    };
    const tabs = promoteSessionTab(promoteSessionTab(NO_SESSION_TABS, SESSION_A, TERMINAL), SESSION_B, GIT);
    writeStoredSessionTabs(tabs, storage);
    expect(readStoredSessionTabs(storage)).toEqual(tabs);
  });

  it("falls back to no tabs for corrupted storage", () => {
    expect(readStoredSessionTabs({ getItem: () => "not json" })).toEqual(NO_SESSION_TABS);
    expect(readStoredSessionTabs({ getItem: () => "[1,2]" })).toEqual(NO_SESSION_TABS);
    expect(readStoredSessionTabs({ getItem: () => { throw new Error("denied"); } })).toEqual(NO_SESSION_TABS);
  });

  it("filters entries that are not qualified contribution ids", () => {
    const raw = JSON.stringify({
      [SESSION_A]: ["core:workspace.terminal", "not-qualified", 7, "core:workspace.terminal"],
      [SESSION_B]: "not-a-list",
    });
    expect(readStoredSessionTabs({ getItem: () => raw })).toEqual({ [SESSION_A]: [TERMINAL] });
  });

  it("uses the shared storage key", () => {
    let requested: string | undefined;
    readStoredSessionTabs({ getItem: (key: string) => { requested = key; return null; } });
    expect(requested).toBe(SESSION_TABS_STORAGE_KEY);
  });
});
