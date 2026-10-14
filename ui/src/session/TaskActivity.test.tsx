// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActivity } from "./TaskActivity";
import type { TaskActivityState } from "./taskActivityStore";
import { NOW, utcClock, VIEWS } from "./fixtures/taskActivity";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function show(view: TaskActivityState, options: { running?: boolean; onRetry?: () => void; onCopy?: (text: string) => Promise<void> } = {}) {
  act(() => root.render(<TaskActivity view={view} running={options.running ?? true} onRetry={options.onRetry ?? (() => undefined)}
    onCopy={options.onCopy} now={() => NOW} clock={utcClock} />));
}
const text = () => host.textContent ?? "";
const rowButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) => button.textContent?.startsWith(label));
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label);
const headings = () => [...host.querySelectorAll("h2")].map((heading) => heading.textContent);

describe("the session's tasks", () => {
  it("shows this turn and the background as owner trees, in plain words", () => {
    show(VIEWS.working);
    expect(headings()).toEqual(["This turn", "In the background"]);
    expect(text()).toContain("3 tasks");
    expect(rowButton("Answering your message")?.textContent).toBe("Answering your messageWaiting for 2 tool calls1 m 12 s");
    expect(rowButton("Run npm test -- durableTriggers")?.textContent).toContain("Stops if Forgerie restarts, and is not run again");
    expect(rowButton("Read src/server/triggers/durableTriggers.ts")?.textContent).toBe("Read src/server/triggers/durableTriggers.tsRunning1 s");
    expect(rowButton("Agent ui")?.textContent).toBe("Agent uiWorking. Its answer comes back here.3 m 40 s");
    expect(rowButton("Report back to this session")?.textContent).toContain("Waits for the agent to finish");
    // The tool call hangs under its turn, the agent's work under the agent.
    expect(rowButton("Answering your message")?.closest("li")?.querySelector("ul")?.textContent).toContain("Run npm test");
    expect(rowButton("Agent ui")?.closest("li")?.querySelector("ul")?.textContent).toContain("Edit ui/src/triggers/TriggerList.tsx");
    expect(text()).toContain("If Forgerie restarts now, 2 tasks stop and are not run again. The other 5 tasks resume on their own.");
    expect(text()).not.toMatch(/Stop the task|Abort/);
  });

  it("opens a row to its public record, and copies the same lines", async () => {
    const onCopy = vi.fn(() => Promise.resolve());
    show(VIEWS.working, { onCopy });
    const run = rowButton("Run npm test")!;
    expect(run.getAttribute("aria-expanded")).toBe("false");
    act(() => run.click());
    expect(run.getAttribute("aria-expanded")).toBe("true");
    const record = document.getElementById(run.getAttribute("aria-controls")!)!;
    expect([...record.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Kind", "Task", "Started", "Scheduler", "Tool"]);
    expect(record.textContent).toContain("1842, owned by task 1840");
    await act(async () => { button("Copy record")!.click(); await Promise.resolve(); });
    expect(onCopy).toHaveBeenCalledWith("Kind: pi.tool\nTask: 1842, owned by task 1840\nStarted: 14:03:43\nScheduler: running\nTool: bash, replay unsafe");
    expect(button("Copied")).toBeDefined();
    act(() => run.click());
    expect(run.getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain("owned by task 1840");
  });

  it("offers no copy where the page cannot write to the clipboard", () => {
    show(VIEWS.working);
    act(() => rowButton("Run npm test")!.click());
    expect(button("Copy record")).toBeUndefined();
  });

  it("starts each agent folded when the panel holds more than 8 rows, and unfolds it on press", () => {
    show(VIEWS.busy);
    expect(text()).not.toContain("ui/src/triggers/TriggerList.tsx");
    const fold = button("3 tasks inside")!;
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(button("2 tasks inside")).toBeDefined();
    act(() => fold.click());
    expect(text()).toContain("ui/src/triggers/TriggerList.tsx");
    expect(button("3 tasks inside")).toBeUndefined();
    expect(button("2 tasks inside")).toBeDefined();
  });

  it("keeps the background agents in view when Pi has finished its turn", () => {
    show(VIEWS.idleBackground, { running: false });
    expect(text()).toContain("Nothing is running for this turn.");
    expect(text()).toContain("2 agents");
    expect(rowButton("Agent review")).toBeDefined();
  });

  it("shows a task that cannot run in the warn tone, and says so in the restart note", () => {
    show(VIEWS.blocked, { running: false });
    const row = rowButton("Reporting an approval result")!;
    expect(row.textContent).toContain("Cannot run: saved by a newer version");
    expect(row.closest("li")?.getAttribute("data-state")).toBe("blocked");
    expect(text()).toContain("If Forgerie restarts now, 1 task cannot run, now or after a restart.");
    expect(text()).not.toContain("everything here resumes");
  });

  it("says when the first read is in flight", () => {
    show(VIEWS.loading);
    expect(host.querySelector("[role=status]")?.textContent).toBe("Reading tasks…");
  });

  it("says each group is empty while the session runs, and shows nothing while it is idle", () => {
    show(VIEWS.empty);
    expect(text()).toContain("Nothing is running for this turn.");
    expect(text()).toContain("Nothing runs in the background.");
    expect(text()).not.toContain("If Forgerie restarts");
    show(VIEWS.empty, { running: false });
    expect(text()).toBe("");
  });

  it("says a failed first read failed, and tries again on press", () => {
    const onRetry = vi.fn();
    show(VIEWS.error, { onRetry });
    expect(text()).toContain("Could not read tasks");
    expect(text()).toContain("Session 01a1224a was not found.");
    expect(text()).not.toContain("may be out of date");
    act(() => button("Try again")!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list after a failed read, and says it may be out of date", () => {
    show(VIEWS.staleError);
    expect(text()).toContain("Could not read tasksThe list below is the last one read, and may be out of date.HTTP 500");
    expect(button("Try again")).toBeDefined();
    expect(rowButton("Answering your message")).toBeDefined();
  });

  it("keeps the last list while the connection is down, and says a read is on its way", () => {
    show({ ...VIEWS.working, stale: true });
    expect(text()).toContain("Waiting for the connection. The list below may be out of date.");
    show({ ...VIEWS.working, stale: true, reading: true });
    expect(text()).toContain("Reading tasks again. The list below may be out of date.");
  });

  it("shows nothing for a session that is not Durable", () => {
    show(VIEWS.unsupported);
    expect(text()).toBe("");
  });
});
