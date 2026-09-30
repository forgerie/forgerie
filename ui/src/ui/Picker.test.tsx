// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationResolver, DEFAULT_COLLAPSED, rows, sections, type PickerSession, type PickerStatus, type Row } from "../picker/board";
import type { CatalogConnection } from "../picker/catalogStore";
import { Picker, type PickerView } from "./Picker";
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
const defaults: PickerPrefs = { grouping: "state", showArchived: false, collapsed: DEFAULT_COLLAPSED };
function render(pickerView: PickerView, onSelect = vi.fn<(row: Row) => void>(), onPrefs = vi.fn<(prefs: PickerPrefs) => void>(), onRetry = vi.fn(), initial = defaults) {
  act(() => root.render(<Harness pickerView={pickerView} initial={initial} onSelect={onSelect} onPrefs={onPrefs} onRetry={onRetry} />));
  return { onSelect, onPrefs, onRetry };
}
const text = () => host.textContent ?? "";
const list = () => host.querySelector<HTMLElement>('[role="listbox"]');
const press = (key: string) => act(() => { list()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

describe("picker", () => {
  it("draws groups in triage order with counts, and live work as counts", () => {
    render(view([S("ask"), S("run"), S("idle")], { statuses: { ask: { ...idle, blocked: true }, run: { ...idle, isStreaming: true, workingAgents: 3, runningProcesses: 1 } } }));
    const labels = [...host.querySelectorAll(".picker-group-label")].map((node) => node.textContent);
    expect(labels).toEqual(["Blocked on you", "Working", "Last hour"]);
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

  it("says when nothing is waiting", () => {
    render(view([S("a")]));
    expect(text()).toContain("Nothing is waiting for you");
    render(view([S("a")], { statuses: { a: { ...idle, blocked: true } } }));
    expect(text()).not.toContain("Nothing is waiting for you");
  });
});

describe("picker prefs storage", () => {
  it("round-trips grouping and collapse, but never archive visibility", () => {
    writePrefs(localStorage, { grouping: "project", showArchived: true, collapsed: new Set(["hour"]) });
    expect(readPrefs(localStorage)).toEqual({ grouping: "project", showArchived: false, collapsed: new Set(["hour"]) });
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
