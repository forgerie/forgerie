// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, WorkspaceActivity } from "../api";
import { ProjectList } from "./ProjectList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("project list behavior", () => {
  it("selects projects and closes them after confirmation", async () => {
    const value = project("project-a");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const list = await mountProjectList([value], new Set());
    list.onSelect = onSelect;
    list.onClose = onClose;
    await list.updateComplete;
    const row = rowFor(list, value.name);

    row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onSelect).toHaveBeenCalledWith(value);
    row.querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    list.shadowRoot?.querySelector<HTMLButtonElement>(".action-menu-panel button")?.click();
    await list.updateComplete;

    expect(confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(value);
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps a project when confirmation is declined", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => false));
    const list = await mountProjectList([project("project-a")], new Set());
    list.onClose = onClose;
    await list.updateComplete;

    rowFor(list, "project-a").querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    list.shadowRoot?.querySelector<HTMLButtonElement>(".action-menu-panel button")?.click();

    expect(onClose).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("routes keyboard navigation and renders collapsed summaries", async () => {
    const value = project("project-a");
    const onSelect = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    const cancel = vi.fn();
    const toggle = vi.fn();
    const list = await mountProjectList([value], new Set());
    Object.assign(list, { selected: value, onSelect, onFocusPreviousSection: previous, onFocusNextSection: next, onCancelKeyboardNavigation: cancel });
    await list.updateComplete;
    const row = rowFor(list, value.name);

    row.dispatchEvent(key("Enter"));
    row.dispatchEvent(key("ArrowLeft"));
    row.dispatchEvent(key("ArrowRight"));
    row.dispatchEvent(key("Escape"));
    expect(onSelect).toHaveBeenCalledWith(value);
    expect(previous).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();

    list.collapsible = true;
    list.collapsed = true;
    list.onToggleCollapsed = toggle;
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".list-body")).toBeNull();
    expect(list.shadowRoot?.textContent).toContain(value.name);
    list.shadowRoot?.querySelector<HTMLButtonElement>(".section-toggle")?.click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("focuses the selected row and closes menus after outside clicks", async () => {
    const value = project("project-a");
    const list = await mountProjectList([value], new Set());
    list.selected = value;
    await list.updateComplete;
    const row = rowFor(list, value.name);
    const focus = vi.fn();
    row.focus = focus;
    row.scrollIntoView = vi.fn();
    expect(await list.focusSelectedOrFirst()).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    row.querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).toBeNull();
  });
});

describe("project unread indicator", () => {
  it("shows an unread dot only on projects tracked as unread", async () => {
    const list = await mountProjectList([project("project-a"), project("project-b")], new Set(["project-b"]));

    expect(unreadDot(rowFor(list, "project-a"))).toBeNull();
    const dot = unreadDot(rowFor(list, "project-b"));
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("Unread sessions in this project");
  });

  it("clears the dot once the project is no longer tracked as unread", async () => {
    const list = await mountProjectList([project("project-a")], new Set(["project-a"]));
    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).not.toBeNull();

    list.unreadProjectIds = new Set();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("wraps the work dot in an unread ring when the project is busy and unread", async () => {
    const list = await mountProjectList([project("project-a")], new Set(["project-a"]));
    list.activities = { "/repo/project-a": workspaceActivity("/repo/project-a", true, false) };
    await list.updateComplete;

    const row = rowFor(list, "project-a");
    const ring = row.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("Unread sessions in this project · Project active");
    expect(row.querySelector(".activity-indicator.unread")).toBeNull();
  });
});

async function mountProjectList(projects: Project[], unreadProjectIds: ReadonlySet<string>): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = projects;
  list.unreadProjectIds = unreadProjectIds;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: ProjectList, projectName: string): HTMLElement {
  const rows = [...(list.shadowRoot?.querySelectorAll(".action-row") ?? [])];
  const row = rows.find((candidate) => candidate.textContent.includes(projectName));
  if (!(row instanceof HTMLElement)) throw new Error(`Expected a project row for ${projectName}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
}

function key(value: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, composed: true });
}

function workspaceActivity(cwd: string, hasSessionActivity: boolean, hasTerminalActivity: boolean): WorkspaceActivity {
  return { cwd, hasSessionActivity, hasTerminalActivity, updatedAt: "2026-06-04T00:00:00.000Z" };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}
