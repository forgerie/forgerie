// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("fork grouping in the session list", () => {
  it("shows one row per distinct session, with the fork count on the root", async () => {
    const list = await renderList(forkedTree());

    expect(visibleLabels(list)).toEqual(["root", "unrelated"]);
    expect(forkToggle(list)?.textContent.replace(/\s+/gu, "")).toBe("›3");
    expect(forkToggle(list)?.getAttribute("aria-expanded")).toBe("false");
    expect(forkToggle(list)?.getAttribute("aria-label")).toBe("Show 3 forks of root");
  });

  it("reveals and re-hides the forks from the count control", async () => {
    const list = await renderList(forkedTree());

    forkToggle(list)?.click();
    await list.updateComplete;
    expect(visibleLabels(list)).toEqual(["root", "fork-a", "fork-b", "fork-c", "unrelated"]);
    expect(forkToggle(list)?.getAttribute("aria-label")).toBe("Hide 3 forks of root");

    forkToggle(list)?.click();
    await list.updateComplete;
    expect(visibleLabels(list)).toEqual(["root", "unrelated"]);
  });

  it("keeps the selected fork on screen without being asked", async () => {
    const sessions = forkedTree();
    const selected = sessions.find((candidate) => candidate.id === "fork-b");
    const list = await renderList(sessions, selected);

    expect(visibleLabels(list)).toEqual(["root", "fork-a", "fork-b", "fork-c", "unrelated"]);
  });

  it("offers no control for a session that was never forked", async () => {
    const list = await renderList([session("solo")]);

    expect(forkToggle(list)).toBeUndefined();
  });

  it("counts nested forks, not just direct children", async () => {
    const root = session("root");
    const fork = session("fork", { parentSessionPath: root.path });
    const list = await renderList([root, fork, session("nested", { parentSessionPath: fork.path })]);

    expect(forkToggle(list)?.getAttribute("aria-label")).toBe("Show 2 forks of root");
    expect(visibleLabels(list)).toEqual(["root"]);
  });
});

function forkedTree(): SessionInfo[] {
  const root = session("root");
  return [
    root,
    session("fork-a", { parentSessionPath: root.path }),
    session("fork-b", { parentSessionPath: root.path }),
    session("fork-c", { parentSessionPath: root.path }),
    session("unrelated"),
  ];
}

async function renderList(sessions: SessionInfo[], selected?: SessionInfo): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  if (selected !== undefined) list.selected = selected;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function visibleLabels(list: SessionList): string[] {
  return [...list.shadowRoot?.querySelectorAll(".action-row .action-name") ?? []]
    .map((name) => name.textContent.replace("↳", "").trim());
}

function forkToggle(list: SessionList): HTMLButtonElement | undefined {
  return list.shadowRoot?.querySelector<HTMLButtonElement>(".fork-toggle") ?? undefined;
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/srv/dev/pi-web",
    created: "2026-07-28T00:00:00.000Z",
    modified: "2026-07-28T00:00:00.000Z",
    messageCount: 3,
    firstMessage: id,
    ...overrides,
  };
}
