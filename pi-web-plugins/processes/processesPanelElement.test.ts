// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- Runtime capabilities are Vitest function mocks in this file. */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspacePanelContext } from "forgerie/plugin-api";
import type { ManagedProcessInfo, ManagedProcessesBrowserEvent, ManagedProcessesRuntime, ManagedProcessesSnapshot } from "forgerie/plugin-api/unstable";
import { defineProcessesPanelElement, processesPanelBadge, processesPanelTagName } from "./processesPanelElement";

beforeAll(() => { defineProcessesPanelElement(); });
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "confirm");
});

describe("managed processes panel", () => {
  it("asks for a selected session when the capability has no target", async () => {
    const runtime = createRuntime({ selected: false });
    const element = mount(runtime);
    await settle();

    expect(element.shadowRoot?.textContent).toContain("Select a session");
    const snapshot = vi.mocked(runtime.snapshot);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("renders the authoritative empty state", async () => {
    const element = mount(createRuntime());
    await settle();

    expect(element.shadowRoot?.textContent).toContain("No managed processes");
  });

  it("sorts running processes first and renders process metadata", async () => {
    const snapshot = createSnapshot([
      processInfo({ id: "old", name: "old", command: "sleep 1", status: "exited", pid: 22 }),
      processInfo({ id: "live", name: "server", command: "npm run dev", cwd: "/repo/app", status: "running", pid: 11 }),
    ]);
    const element = mount(createRuntime({ snapshot }));
    await settle();

    const cards = element.shadowRoot?.querySelectorAll(".process-card");
    expect(cards).toHaveLength(2);
    expect(cards?.[0]?.textContent).toContain("server");
    expect(cards?.[0]?.textContent).toContain("npm run dev");
    expect(cards?.[0]?.textContent).toContain("/repo/app");
    expect(cards?.[0]?.textContent).toContain("PID 11");
    expect(cards?.[0]?.querySelector(".meta")?.textContent).toMatch(/\d+h \d+m/u);
  });

  it("loads interleaved output when a process is expanded", async () => {
    const runtime = createRuntime({ snapshot: createSnapshot([processInfo()]) });
    const output = vi.mocked(runtime.output);
    output.mockResolvedValue({ ok: true, lines: [
      { type: "stdout", text: "one\n" },
      { type: "stderr", text: "two\n" },
      { type: "stdout", text: "three\n" },
    ] });
    const element = mount(runtime);
    await settle();

    element.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle='process-1']")?.click();
    await settle();

    expect(output).toHaveBeenCalledWith("process-1", 200);
    const lines = [...(element.shadowRoot?.querySelectorAll(".logs span") ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual(["one\n", "two\n", "three\n"]);
    expect(lines.map((line) => line.className)).toEqual(["stdout", "stderr", "stdout"]);
  });

  it("shows stdin only when the session protocol supports writing", async () => {
    const process = processInfo();
    const unsupported = mount(createRuntime({ snapshot: createSnapshot([process], false) }));
    await settle();
    unsupported.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle]")?.click();
    await settle();
    expect(unsupported.shadowRoot?.querySelector("[data-stdin]")).toBeNull();

    unsupported.remove();
    const supported = mount(createRuntime({ snapshot: createSnapshot([process], true) }));
    await settle();
    supported.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle]")?.click();
    await settle();
    expect(supported.shadowRoot?.querySelector("[data-stdin='process-1']")).not.toBeNull();
  });

  it("confirms and requests a process stop", async () => {
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const runtime = createRuntime({ snapshot: createSnapshot([processInfo()]) });
    const kill = vi.mocked(runtime.kill);
    kill.mockResolvedValue({ ok: true, process: processInfo({ status: "terminating" }) });
    const element = mount(runtime);
    await settle();

    element.shadowRoot?.querySelector<HTMLButtonElement>("[data-stop='process-1']")?.click();
    await settle();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("npm run dev"));
    expect(kill).toHaveBeenCalledWith("process-1");
    expect(element.shadowRoot?.textContent).toContain("Stop requested");
  });

  it("does not report a kill race as an error after the process has exited", async () => {
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    let listener: ((event: ManagedProcessesBrowserEvent) => void) | undefined;
    let resolveKill: ((result: { ok: false; reason: "not_found" }) => void) | undefined;
    const runtime = createRuntime({ snapshot: createSnapshot([processInfo()]) });
    vi.mocked(runtime.subscribe).mockImplementation((value) => {
      listener = value;
      return vi.fn();
    });
    vi.mocked(runtime.kill).mockReturnValue(new Promise((resolve) => { resolveKill = resolve; }));
    const element = mount(runtime);
    await settle();

    element.shadowRoot?.querySelector<HTMLButtonElement>("[data-stop='process-1']")?.click();
    listener?.({ type: "processes.update", snapshot: createSnapshot([processInfo({ status: "exited", endTime: 200, exitCode: 0, success: true, endReason: "exit" })]) });
    resolveKill?.({ ok: false, reason: "not_found" });
    await settle();

    expect(element.shadowRoot?.textContent).toContain("Process stopped");
    expect(element.shadowRoot?.querySelector(".notice.error")).toBeNull();
  });

  it("writes newline-terminated stdin and clears the input", async () => {
    const runtime = createRuntime({ snapshot: createSnapshot([processInfo()], true) });
    const element = mount(runtime);
    await settle();
    element.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle]")?.click();
    await settle();

    const input = element.shadowRoot?.querySelector<HTMLInputElement>("[data-stdin='process-1']");
    expect(input).not.toBeNull();
    if (input === null || input === undefined) return;
    input.value = "yes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    element.shadowRoot?.querySelector<HTMLFormElement>("[data-stdin-form='process-1']")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const write = vi.mocked(runtime.write);
    expect(write).toHaveBeenCalledWith("process-1", "yes\n");
    expect(element.shadowRoot?.querySelector<HTMLInputElement>("[data-stdin='process-1']")?.value).toBe("");
  });

  it("applies authoritative snapshots and live output from the subscription", async () => {
    let listener: ((event: ManagedProcessesBrowserEvent) => void) | undefined;
    const runtime = createRuntime({ snapshot: createSnapshot([processInfo()]) });
    const subscribe = vi.mocked(runtime.subscribe);
    subscribe.mockImplementation((value) => {
      listener = value;
      return vi.fn();
    });
    const element = mount(runtime);
    await settle();
    element.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle]")?.click();
    await settle();

    listener?.({ type: "processes.output", id: "process-1", lines: [{ type: "stderr", text: "live\n" }], droppedLines: 2 });
    expect(element.shadowRoot?.textContent).toContain("live");
    expect(element.shadowRoot?.textContent).toContain("2 earlier output updates were omitted");

    listener?.({ type: "processes.update", snapshot: createSnapshot([processInfo(), processInfo({ id: "process-2", name: "worker" })]) });
    expect(element.shadowRoot?.querySelectorAll(".process-card")).toHaveLength(2);
  });

  it("unsubscribes when removed", async () => {
    const unsubscribe = vi.fn();
    const runtime = createRuntime();
    const subscribe = vi.mocked(runtime.subscribe);
    subscribe.mockReturnValue(unsubscribe);
    const element = mount(runtime);
    await settle();

    element.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores a stale snapshot after session identity changes", async () => {
    let resolveOld: ((snapshot: ManagedProcessesSnapshot) => void) | undefined;
    const oldRuntime = createRuntime();
    const oldSnapshot = vi.mocked(oldRuntime.snapshot);
    oldSnapshot.mockReturnValue(new Promise((resolve) => { resolveOld = resolve; }));
    const element = mount(oldRuntime);
    await settle();

    const newRuntime = createRuntime({ sessionId: "session-2", snapshot: createSnapshot([processInfo({ name: "new" })]) });
    Reflect.set(element, "context", createContext(newRuntime));
    await settle();
    resolveOld?.(createSnapshot([processInfo({ name: "stale" })]));
    await settle();

    expect(element.shadowRoot?.textContent).toContain("new");
    expect(element.shadowRoot?.textContent).not.toContain("stale");
  });

  it("shows a badge when no session capability is usable", () => {
    expect(processesPanelBadge(createContext(undefined))).toBe("!");
    expect(processesPanelBadge(createContext(createRuntime({ selected: false })))).toBe("!");
    expect(processesPanelBadge(createContext(createRuntime()))).toBeUndefined();
    expect(processesPanelBadge(createContext(createRuntime({ snapshot: createSnapshot([processInfo(), processInfo({ id: "process-2" })]) })))).toBe(2);
  });
});

function mount(runtime: ManagedProcessesRuntime): HTMLElement {
  const element = document.createElement(processesPanelTagName);
  Reflect.set(element, "context", createContext(runtime));
  document.body.appendChild(element);
  return element;
}

function createContext(runtime: ManagedProcessesRuntime | undefined): WorkspacePanelContext {
  const unavailable = () => Promise.reject(new Error("unused test capability"));
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false },
    files: { readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable },
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: { open: vi.fn(), runCommand: unavailable },
  };
  Object.defineProperty(context, "piWebUnstable", { enumerable: true, value: runtime === undefined ? undefined : { managedProcesses: runtime } });
  return context;
}

function createRuntime(options: { selected?: boolean; sessionId?: string; snapshot?: ManagedProcessesSnapshot } = {}): ManagedProcessesRuntime {
  return {
    selectedSession: options.selected === false ? undefined : { machineId: "local", id: options.sessionId ?? "session-1", cwd: "/repo" },
    currentSnapshot: vi.fn(() => options.snapshot),
    snapshot: vi.fn(() => Promise.resolve(options.snapshot ?? createSnapshot())),
    output: vi.fn(() => Promise.resolve({ ok: true as const, lines: [] })),
    kill: vi.fn(() => Promise.resolve({ ok: false as const, reason: "not_found" as const })),
    write: vi.fn(() => Promise.resolve({ ok: true as const })),
    subscribe: vi.fn(() => vi.fn()),
  };
}

function createSnapshot(processes: ManagedProcessInfo[] = [], writeSupported = false): ManagedProcessesSnapshot {
  return { available: true, writeSupported, processes };
}

function processInfo(overrides: Partial<ManagedProcessInfo> = {}): ManagedProcessInfo {
  return {
    id: "process-1",
    name: "dev server",
    pid: 123,
    command: "npm run dev",
    cwd: "/repo",
    startTime: 100,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
