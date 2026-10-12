// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationResolver, DEFAULT_COLLAPSED, rows, sections, type PickerSession, type PickerStatus, type Row } from "../picker/board";
import type { CatalogConnection } from "../picker/catalogStore";
import { Picker, PickerToast, type PickerView } from "./Picker";
import { readPrefs, writePrefs, PREFS_KEY, type PickerPrefs } from "../picker/prefs";
import { shellLayout, DOCK_MIN_WIDTH } from "./AppShell";

const NOW = new Date(2026, 8, 29, 18, 40).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const locate = createLocationResolver([{ id: "p", name: "forgerie", path: "/code/forgerie" }], []);
const S = (id: string, extra: Partial<PickerSession> = {}): PickerSession => ({ id, cwd: "/code/forgerie", name: `Session ${id}`, modified: ago(5), ...extra });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); localStorage.clear(); });

function view(sessions: PickerSession[], options: { statuses?: Record<string, PickerStatus>; connection?: CatalogConnection; selectedId?: string; grouping?: "state" | "project"; showArchived?: boolean } = {}): PickerView {
  const all = rows({ sessions, statuses: options.statuses ?? {}, activities: {}, unread: new Set(), locate, now: NOW });
  return {
    connection: options.connection ?? { type: "ready" },
    sections: sections(all, { grouping: options.grouping ?? "state", showArchived: options.showArchived ?? false, now: NOW }),
    machines: 1, selectedId: options.selectedId, archivedCount: all.filter((row) => row.state === "archived").length,
  };
}
/** Owns prefs the way usePicker does, so the view is exercised with real state. */
function Harness({ pickerView, initial, onSelect, onPrefs, onRetry }: {
  pickerView: PickerView; initial: PickerPrefs; onSelect: (row: Row) => void; onPrefs: (prefs: PickerPrefs) => void; onRetry: () => void;
}) {
  const [prefs, setPrefs] = useState(initial);
  return <Picker view={pickerView} prefs={prefs} onPrefs={(next) => { setPrefs(next); onPrefs(next); }} actions={{ onSelect, onRetry }} />;
}
const defaults: PickerPrefs = { grouping: "state", showArchived: false, allPinned: false, collapsed: DEFAULT_COLLAPSED };
function render(pickerView: PickerView, onSelect = vi.fn<(row: Row) => void>(), onPrefs = vi.fn<(prefs: PickerPrefs) => void>(), onRetry = vi.fn(), initial = defaults) {
  act(() => root.render(<Harness pickerView={pickerView} initial={initial} onSelect={onSelect} onPrefs={onPrefs} onRetry={onRetry} />));
  return { onSelect, onPrefs, onRetry };
}
/** Derives sections from its own prefs, as usePicker does, so prefs that reshape the list take effect. */
function LiveHarness({ sessions, selectedId }: { sessions: PickerSession[]; selectedId?: string }) {
  const [prefs, setPrefs] = useState(defaults);
  const all = rows({ sessions, statuses: {}, activities: {}, unread: new Set(), locate, now: NOW });
  const pickerView: PickerView = { connection: { type: "ready" }, machines: 1, selectedId, archivedCount: 0,
    sections: sections(all, { grouping: prefs.grouping, showArchived: prefs.showArchived, allPinned: prefs.allPinned, selectedId, now: NOW }) };
  return <Picker view={pickerView} prefs={prefs} onPrefs={setPrefs} actions={{ onSelect: () => {}, onRetry: () => {} }} />;
}
const text = () => host.textContent ?? "";
const list = () => host.querySelector<HTMLElement>('[role="listbox"]');
const press = (key: string) => act(() => { list()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

describe("picker", () => {
  it("draws groups in triage order with counts, and live work as counts", () => {
    render(view([S("ask"), S("run"), S("idle")], { statuses: { ask: { ...idle, blocked: true }, run: { ...idle, isStreaming: true, workingAgents: 3, runningProcesses: 1 } } }));
    const labels = [...host.querySelectorAll(".picker-group-label")].map((node) => node.textContent);
    expect(labels).toEqual(["Needs your response", "Working", "Last hour"]);
    const running = host.querySelector('[data-session="run"]');
    expect(running?.querySelector('[aria-label="3 agents working"]')?.textContent).toBe("3");
    expect(running?.querySelector('[aria-label="1 process running"]')?.textContent).toBe("1");
  });

  it("shows no chat text: an unnamed session reads Untitled session", () => {
    render(view([S("x", { name: undefined })]));
    expect(host.querySelector('[data-session="x"] .picker-title')?.textContent).toBe("Untitled session");
  });

  it("opens a row on click", () => {
    const { onSelect } = render(view([S("a")]));
    act(() => { host.querySelector<HTMLElement>('[data-session="a"]')?.click(); });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: "a" }) }));
  });

  it("walks rows with J and K in drawn order, skipping collapsed groups", () => {
    const sessions = [S("ask"), S("new", { modified: ago(2) }), S("old", { modified: ago(60 * 24 * 10) })];
    const { onSelect } = render(view(sessions, { statuses: { ask: { ...idle, blocked: true } }, selectedId: "ask" }));
    press("j");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: "new" }) }));
    render(view(sessions, { statuses: { ask: { ...idle, blocked: true } }, selectedId: "new" }), onSelect);
    press("j");
    // "old" sits in This month, which starts collapsed. J stops at the last visible row.
    expect(onSelect).toHaveBeenCalledTimes(1);
    press("k");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: "ask" }) }));
  });

  it("collapses a group and reports the new arrangement", () => {
    const { onPrefs } = render(view([S("a")]));
    const header = host.querySelector<HTMLButtonElement>(".picker-group-header");
    act(() => header?.click());
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-session="a"]')).toBeNull();
    expect([...(onPrefs.mock.lastCall?.[0].collapsed ?? [])]).toContain("hour");
  });

  it("keeps the selected session's group open even if it was collapsed", () => {
    render(view([S("a")], { selectedId: "a" }), undefined, undefined, undefined, { ...defaults, collapsed: new Set(["hour"]) });
    expect(host.querySelector('[data-session="a"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("switches grouping with G and archive visibility with A", () => {
    const { onPrefs } = render(view([S("a")]));
    press("g");
    expect(onPrefs.mock.lastCall?.[0]).toMatchObject({ grouping: "project", showArchived: false });
    press("a");
    expect(onPrefs.mock.lastCall?.[0]).toMatchObject({ grouping: "project", showArchived: true });
  });

  it("disables Show archived when nothing is archived", () => {
    render(view([S("a")]));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="More session commands"]')?.click());
    expect(host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.disabled).toBe(true);
  });

  it("names the empty, loading, and failed states", () => {
    render(view([], { connection: { type: "loading" } }));
    expect(host.querySelector('[aria-label="Loading sessions"]')).not.toBeNull();
    render(view([]));
    expect(text()).toContain("No sessions yet");
    const { onRetry } = render(view([], { connection: { type: "failed", message: "HTTP 500" } }));
    expect(text()).toContain("Could not load sessions");
    act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry now")?.click());
    expect(onRetry).toHaveBeenCalled();
  });

  it("keeps rows while reconnecting and says so", () => {
    render(view([S("a")], { connection: { type: "reconnecting" } }));
    expect(text()).toContain("Reconnecting");
    expect(host.querySelector('[data-session="a"]')).not.toBeNull();
  });

  it("caps Pinned at three, keeps the full count, and expands on request", () => {
    const pins = Array.from({ length: 12 }, (_, index) => S(`p${String(index)}`, { pinned: true, modified: ago(index + 1) }));
    act(() => root.render(<LiveHarness sessions={pins} />));
    const pinned = () => host.querySelector('[data-kind="pinned"]');
    expect(pinned()?.querySelector(".picker-count")?.textContent).toBe("12");
    expect(pinned()?.querySelectorAll(".picker-row")).toHaveLength(3);
    const more = () => pinned()?.querySelector<HTMLButtonElement>(".picker-more");
    expect(more()?.textContent?.trim()).toBe("Show 9 more");
    act(() => more()?.click());
    expect(pinned()?.querySelectorAll(".picker-row")).toHaveLength(12);
    expect(more()?.textContent?.trim()).toBe("Show fewer");
    act(() => more()?.click());
    expect(pinned()?.querySelectorAll(".picker-row")).toHaveLength(3);
  });

  it("leaves the pin glyph to the Pinned heading, and draws it where no heading says so", () => {
    render(view([S("a", { pinned: true })]));
    expect(host.querySelector('[data-kind="pinned"] [data-session="a"] .picker-pin')).toBeNull();
    render(view([S("a", { pinned: true })], { grouping: "project" }));
    expect(host.querySelector('[data-session="a"] .picker-pin')).not.toBeNull();
  });

  it("shows no Show more control when there are three pins or fewer", () => {
    act(() => root.render(<LiveHarness sessions={[S("a", { pinned: true }), S("b", { pinned: true })]} />));
    expect(host.querySelector(".picker-more")).toBeNull();
  });

  it("says when nothing is waiting", () => {
    render(view([S("a")]));
    expect(text()).toContain("Nothing is waiting for you");
    render(view([S("a")], { statuses: { a: { ...idle, blocked: true } } }));
    expect(text()).not.toContain("Nothing is waiting for you");
  });
});

describe("project filter", () => {
  const menuButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
  const openMenu = () => act(() => host.querySelector<HTMLButtonElement>('[aria-label="More session commands"]')!.click());
  const drawFiltered = (value: string, filter: { onChoose: (value: string) => void; onManage: () => void }, options = [{ value: "kori", label: "KORI", detail: "2 projects" }]) =>
    act(() => root.render(<Picker view={view([S("a")])} prefs={defaults} onPrefs={() => {}} actions={{ onSelect: () => {}, onRetry: () => {} }}
      filter={{ options, value, ...filter }} />));

  it("draws nothing above the list until a group is chosen", () => {
    drawFiltered("", { onChoose: vi.fn(), onManage: vi.fn() });
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(text()).not.toContain("KORI");
  });

  it("offers groups in the menu under the grouping, with a way to edit them", () => {
    const onChoose = vi.fn();
    const onManage = vi.fn();
    drawFiltered("", { onChoose, onManage });
    openMenu();
    expect(menuButtons().map((node) => node.textContent)).toEqual(["Group by state", "Group by projectG", "Show archived 0 · A", "All projects", "KORI2 projects", "Edit project groups…"]);
    act(() => menuButtons()[4]!.click());
    expect(onChoose).toHaveBeenCalledWith("kori");
    openMenu();
    act(() => menuButtons().at(-1)!.click());
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("offers only the way to make a group when none exist", () => {
    drawFiltered("", { onChoose: vi.fn(), onManage: vi.fn() }, []);
    openMenu();
    expect(menuButtons().map((node) => node.textContent).slice(3)).toEqual(["Group projects…"]);
  });

  it("names the chosen group above the list and clears it in one press", () => {
    const onChoose = vi.fn();
    drawFiltered("kori", { onChoose, onManage: vi.fn() });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("KORI2 projects");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Show all projects"]')!.click());
    expect(onChoose).toHaveBeenCalledWith("");
  });

  it("keeps G switching the grouping while a group is chosen", () => {
    const onPrefs = vi.fn();
    act(() => root.render(<Picker view={view([S("a")])} prefs={defaults} onPrefs={onPrefs} actions={{ onSelect: () => {}, onRetry: () => {} }}
      filter={{ options: [{ value: "kori", label: "KORI", detail: "2 projects" }], value: "kori", onChoose: vi.fn(), onManage: vi.fn() }} />));
    press("g");
    expect(onPrefs).toHaveBeenCalledWith(expect.objectContaining({ grouping: "project" }));
  });
});

describe("new session", () => {
  it("starts a new session from the button at the top of the list, or with N", () => {
    const onNew = vi.fn();
    act(() => root.render(<Picker view={view([S("a")])} prefs={defaults} onPrefs={() => {}} actions={{ onSelect: () => {}, onRetry: () => {}, onNew }} />));
    const button = host.querySelector<HTMLButtonElement>(".picker-new")!;
    expect(button.textContent).toBe("New session");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("N");
    act(() => button.click());
    press("n");
    expect(onNew).toHaveBeenCalledTimes(2);
  });

  it("offers it on an empty list too", () => {
    act(() => root.render(<Picker view={view([])} prefs={defaults} onPrefs={() => {}} actions={{ onSelect: () => {}, onRetry: () => {}, onNew: () => {} }} />));
    expect(host.querySelector(".picker-new")).not.toBeNull();
  });
});

describe("row commands", () => {
  function renderCommands(pickerView: PickerView) {
    const onCommand = vi.fn<(row: Row, kind: string) => void>();
    const onSelect = vi.fn<(row: Row) => void>();
    const onUndo = vi.fn();
    const onDismissToast = vi.fn();
    act(() => root.render(<Picker view={pickerView} prefs={{ ...defaults, showArchived: true }} onPrefs={() => {}}
      actions={{ onSelect, onRetry: () => {}, onCommand, onUndo, onDismissToast }} />));
    return { onCommand, onSelect, onUndo, onDismissToast };
  }
  const rowOf = (id: string) => host.querySelector<HTMLElement>(`[data-session="${id}"]`);
  const items = () => [...host.querySelectorAll<HTMLButtonElement>('.picker-row-menu [role="menuitem"]')];
  const labels = () => items().map((item) => item.textContent);
  const rightClick = (id: string) => act(() => { rowOf(id)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });

  it("opens the row menu on right click without opening the session", () => {
    const { onSelect } = renderCommands(view([S("a")]));
    rightClick("a");
    expect(labels()).toEqual(["Pin to top", "ArchiveE", "Copy workspace path", "Copy session ID"]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(items()[0]);
  });

  it("shows archive disabled with its reason on a running session", () => {
    renderCommands(view([S("a")], { statuses: { a: { ...idle, isStreaming: true } } }));
    rightClick("a");
    const archive = items().find((item) => item.dataset["command"] === "archive");
    expect(archive?.disabled).toBe(true);
    expect(archive?.textContent).toBe("ArchiveStop the run first");
  });

  it("runs a command and closes the menu", () => {
    const { onCommand } = renderCommands(view([S("a")]));
    rightClick("a");
    act(() => items()[0]?.click());
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: "a" }) }), "pin");
    expect(host.querySelector(".picker-row-menu")).toBeNull();
  });

  it("asks twice, in place, before a permanent delete", () => {
    const { onCommand } = renderCommands(view([S("x", { archived: true })], { showArchived: true }));
    rightClick("x");
    expect(labels()).toEqual(["Restore", "Delete permanently", "Copy workspace path", "Copy session ID"]);
    const del = () => items().find((item) => item.dataset["command"] === "delete");
    act(() => del()?.click());
    expect(onCommand).not.toHaveBeenCalled();
    expect(del()?.textContent).toBe("Delete for good?");
    act(() => del()?.click());
    expect(onCommand).toHaveBeenCalledWith(expect.anything(), "delete");
  });

  it("opens the selected row's menu from its visible ⋯ and from the Menu key", () => {
    const { onSelect } = renderCommands(view([S("a"), S("b")], { selectedId: "a" }));
    act(() => rowOf("a")?.querySelector<HTMLButtonElement>(".picker-row-more")?.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(host.querySelector("#picker-menu-a")).not.toBeNull();
    act(() => { host.querySelector(".picker-row-menu")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector(".picker-row-menu")).toBeNull();
    press("ContextMenu");
    expect(host.querySelector("#picker-menu-a")).not.toBeNull();
  });

  it("archives the selected row with E, and not a running one", () => {
    const { onCommand } = renderCommands(view([S("a")], { selectedId: "a" }));
    press("e");
    expect(onCommand).toHaveBeenCalledWith(expect.anything(), "archive");
    const running = renderCommands(view([S("a")], { selectedId: "a", statuses: { a: { ...idle, isStreaming: true } } }));
    press("e");
    expect(running.onCommand).not.toHaveBeenCalled();
  });

  it("opens the menu on a touch hold, and the release does not open the session", () => {
    vi.useFakeTimers();
    try {
      const { onSelect } = renderCommands(view([S("a")]));
      const row = rowOf("a");
      act(() => { row?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 10, clientY: 10 })); });
      act(() => { vi.advanceTimersByTime(500); });
      expect(host.querySelector("#picker-menu-a")).not.toBeNull();
      act(() => { row?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })); row?.click(); });
      expect(onSelect).not.toHaveBeenCalled();
      // A scroll is not a hold.
      act(() => { host.querySelector<HTMLElement>(".picker-group-header")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
      act(() => { row?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 10, clientY: 10 })); });
      act(() => { row?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientX: 10, clientY: 40 })); });
      act(() => { vi.advanceTimersByTime(600); });
      expect(host.querySelector(".picker-row-menu")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("offers undo after an archive, names a kept worktree in the title, and reports a refusal as an alert", () => {
    const onUndo = vi.fn();
    const note = { title: "Worktree kept", text: "Another session still works in the worktree fix." };
    act(() => root.render(<PickerToast toast={{ type: "undo", target: { id: "z", cwd: "/c", name: "Zed" }, note }} onUndo={onUndo} />));
    expect(host.querySelector('.toast[role="status"] .toast-message')?.textContent).toBe("Archived Zed. Worktree kept.");
    expect(host.querySelector(".toast-detail")?.textContent).toBe(note.text);
    act(() => root.render(<PickerToast toast={{ type: "note", note }} />));
    expect(host.querySelector(".toast-message")?.textContent).toBe("Worktree kept");
    act(() => root.render(<PickerToast toast={{ type: "undo", target: { id: "z", cwd: "/c", name: "Zed" } }} onUndo={onUndo} />));
    expect(host.querySelector(".toast-message")?.textContent).toBe("Archived Zed");
    expect(host.querySelector(".toast-more")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>(".toast-action")?.click());
    expect(onUndo).toHaveBeenCalled();
    const onDismiss = vi.fn();
    act(() => root.render(<PickerToast toast={{ type: "error", text: "Unpin session before archiving" }} onDismiss={onDismiss} />));
    expect(host.querySelector('.toast[role="alert"]')?.textContent).toContain("Unpin session before archiving");
    expect(host.querySelector(".toast-action")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('.toast [aria-label="Dismiss"]')?.click());
    expect(onDismiss).toHaveBeenCalled();
  });

  it("no longer draws a command's message inside the list", () => {
    renderCommands({ ...view([S("a")]), toast: { type: "undo", target: { id: "z", cwd: "/c", name: "Zed" } } });
    expect(host.querySelector(".toast")).toBeNull();
  });
});

describe("picker prefs storage", () => {
  it("round-trips grouping and collapse, but never archive visibility", () => {
    writePrefs(localStorage, { grouping: "project", showArchived: true, allPinned: true, collapsed: new Set(["hour"]) });
    expect(readPrefs(localStorage)).toEqual({ grouping: "project", showArchived: false, allPinned: false, collapsed: new Set(["hour"]) });
  });
  it("falls back to defaults on missing or corrupt data", () => {
    expect(readPrefs(localStorage)).toEqual(defaults);
    localStorage.setItem(PREFS_KEY, "{not json");
    expect(readPrefs(localStorage)).toEqual(defaults);
    expect(readPrefs(undefined)).toEqual(defaults);
  });
});

describe("dock rule A", () => {
  it("overlays below the dock width and docks at or above it", () => {
    for (const fold of [475, 704, 711, 932]) expect(shellLayout(fold)).toBe("overlay");
    expect(shellLayout(DOCK_MIN_WIDTH - 1)).toBe("overlay");
    expect(shellLayout(DOCK_MIN_WIDTH)).toBe("docked");
  });
});
