// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalsApi, type TerminalCommandRun, type TerminalInfo, type Workspace } from "../api";
import { TERMINAL_SOFT_KEYS_STORAGE_KEY } from "../terminalSoftKeysPreference";
import { TerminalPanel, filterTerminalInput } from "./TerminalPanel";

const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
  effectiveConfig: {},
};

const runningRun: TerminalCommandRun = {
  id: "run-1",
  origin: "core",
  projectId: workspace.projectId,
  workspaceId: workspace.id,
  terminalId: "terminal-1",
  title: "Build",
  command: "npm run build",
  status: "running",
  createdAt: "2026-08-19T00:00:00.000Z",
  metadata: {},
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", RecordingIntersectionObserver);
  vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TerminalPanel", () => {
  it("keeps shell creation unavailable until a workspace is selected", async () => {
    const withoutWorkspace = await mount();
    const withWorkspace = await mount(workspace);

    expect(newShellButton(withoutWorkspace).disabled).toBe(true);
    expect(newShellButton(withWorkspace).disabled).toBe(false);
  });

  it("renders loading and failure states from terminal discovery", async () => {
    const element = await mount(workspace);

    seedState(element, { loading: true, error: "terminal service unavailable" });
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector(".muted")?.textContent).toBe("Loading terminals…");
    expect(element.shadowRoot?.querySelector(".error")?.textContent).toBe("terminal service unavailable");
  });

  it("loads terminal and command catalogs when the workspace becomes visible", async () => {
    const terminals = vi.spyOn(terminalsApi, "terminals").mockResolvedValue([]);
    const commandRuns = vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([]);
    const element = await mount(workspace);

    seedState(element, { visible: true });
    await element.updateComplete;

    await vi.waitFor(() => {
      expect(terminals).toHaveBeenCalledWith("project-1", "workspace-1", "local");
      expect(commandRuns).toHaveBeenCalledWith({ projectId: "project-1", workspaceId: "workspace-1" }, "local");
    });
    expect(element.shadowRoot?.querySelector(".error")).toBeNull();
  });

  it("shows terminal catalog failures without leaving the loading state active", async () => {
    vi.spyOn(terminalsApi, "terminals").mockRejectedValue(new Error("terminal catalog unavailable"));
    vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([]);
    const element = await mount(workspace);

    seedState(element, { visible: true });
    await element.updateComplete;

    await vi.waitFor(() => {
      expect(element.shadowRoot?.querySelector(".error")?.textContent).toBe("terminal catalog unavailable");
    });
    expect(element.shadowRoot?.querySelector(".muted")).toBeNull();
  });

  it("clears terminal state when the workspace scope changes", async () => {
    const element = await mount(workspace);
    seedState(element, { terminals: [terminal()], selectedId: "terminal-1" });
    await element.updateComplete;

    element.workspace = { ...workspace, id: "workspace-2", path: "/other" };
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector("button.selected")).toBeNull();
    expect(element.shadowRoot?.querySelectorAll(".terminal-tabs > button:not(.new)")).toHaveLength(0);
  });

  it("renders selected terminal controls and toggles touch keys", async () => {
    const element = await mount(workspace);
    seedState(element, {
      terminals: [terminal()],
      selectedId: "terminal-1",
      softKeysEnabled: true,
    });
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector(".terminal-tabs > button.selected:not(.soft-keys-toggle) span")?.textContent).toBe("Shell");
    expect(element.shadowRoot?.querySelector("terminal-soft-keys")).not.toBeNull();
    const toggle = element.shadowRoot?.querySelector<HTMLButtonElement>(".soft-keys-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");

    toggle?.click();
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector("terminal-soft-keys")).toBeNull();
    expect(localStorage.getItem(TERMINAL_SOFT_KEYS_STORAGE_KEY)).toBe("false");
  });

  it("cancels a running command through the command notice", async () => {
    const cancelled = { ...runningRun, status: "failed" as const, exitCode: 130, completedAt: "2026-08-19T00:00:01.000Z" };
    const cancel = vi.spyOn(terminalsApi, "cancelCommandRun").mockResolvedValue(cancelled);
    vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([cancelled]);
    const element = await mount(workspace);
    seedState(element, {
      terminals: [terminal({ commandRunId: runningRun.id })],
      commandRuns: [runningRun],
      selectedId: "terminal-1",
    });
    await element.updateComplete;

    const notice = element.shadowRoot?.querySelector(".command-run-notice.running");
    expect(notice?.textContent).toContain("Command is running");
    notice?.querySelector<HTMLButtonElement>("button")?.click();

    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledWith("run-1", "local");
      expect(element.shadowRoot?.querySelector(".command-run-notice.running")).toBeNull();
    });
  });

  it("continues an exited command terminal as an interactive shell", async () => {
    const continued = terminal({ exited: false });
    const continueTerminal = vi.spyOn(terminalsApi, "continueTerminal").mockResolvedValue(continued);
    const element = await mount(workspace);
    seedState(element, {
      terminals: [terminal({ exited: true, exitCode: 0, commandRunId: runningRun.id })],
      commandRuns: [{ ...runningRun, status: "succeeded", exitCode: 0, completedAt: "2026-08-19T00:00:01.000Z" }],
      selectedId: "terminal-1",
    });
    await element.updateComplete;

    const notice = element.shadowRoot?.querySelector(".command-run-notice.succeeded");
    expect(notice?.textContent).toContain("Command succeeded with exit code 0");
    notice?.querySelector<HTMLButtonElement>("button")?.click();

    await vi.waitFor(() => {
      expect(continueTerminal).toHaveBeenCalledWith("project-1", "workspace-1", "terminal-1", "local");
      expect(element.shadowRoot?.querySelector(".command-run-notice")).toBeNull();
    });
  });

  it("closes the selected terminal and publishes the fallback selection", async () => {
    vi.spyOn(terminalsApi, "closeTerminal").mockResolvedValue({ closed: true });
    const onSelectTerminal = vi.fn();
    const element = await mount(workspace, onSelectTerminal);
    seedState(element, {
      terminals: [terminal(), terminal({ id: "terminal-2", name: "Second" })],
      selectedId: "terminal-1",
    });
    await element.updateComplete;

    const close = element.shadowRoot?.querySelector<HTMLButtonElement>("button.selected small");
    close?.click();

    await vi.waitFor(() => { expect(onSelectTerminal).toHaveBeenCalledWith("terminal-2", { replace: true }); });
    expect(element.shadowRoot?.textContent).not.toContain("ShellSecond");
  });
});

describe("filterTerminalInput", () => {
  it("removes focus tracking sequences without changing user input", () => {
    expect(filterTerminalInput("before\u001b[Iinside\u001b[Oafter")).toBe("beforeinsideafter");
    expect(filterTerminalInput("plain input")).toBe("plain input");
  });
});

async function mount(
  selectedWorkspace?: Workspace,
  onSelectTerminal: TerminalPanel["onSelectTerminal"] = () => undefined,
): Promise<TerminalPanel> {
  const element = new TerminalPanel();
  element.workspace = selectedWorkspace;
  element.onSelectTerminal = onSelectTerminal;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function seedState(element: TerminalPanel, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!Reflect.set(element, key, value)) throw new Error(`Could not seed TerminalPanel.${key}`);
  }
  element.requestUpdate();
}

function newShellButton(element: TerminalPanel): HTMLButtonElement {
  const button = element.shadowRoot?.querySelector("button.new");
  if (!(button instanceof HTMLButtonElement)) throw new Error("TerminalPanel did not render the new-shell control");
  return button;
}

function terminal(patch: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: "terminal-1",
    cwd: workspace.path,
    name: "Shell",
    createdAt: "2026-08-19T00:00:00.000Z",
    exited: false,
    ...patch,
  };
}

class RecordingIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  disconnect(): void { /* no resources */ }
  observe(): void { /* visibility is controlled by each test */ }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve(): void { /* no resources */ }
}

class RecordingResizeObserver {
  disconnect(): void { /* no resources */ }
  observe(): void { /* geometry is not part of these tests */ }
  unobserve(): void { /* no resources */ }
}
