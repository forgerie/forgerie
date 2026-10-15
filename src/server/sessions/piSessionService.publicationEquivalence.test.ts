import { expect, it, vi } from "vitest";
import type { ClientSessionStatus } from "../types.js";
import type { DecisionHints } from "../decisions/decisionHints.js";
import { assertDecisionHintOffEquivalence } from "../decisions/decisionHintsOffEquivalence.testSupport.js";
import { startupDialogService, ACTIVE_SESSION_ID } from "./piSessionService.extensionDialogs.testSupport.js";
import { sessionRef } from "./piSessionService.testSupport.js";

/** These observations are also run against main (50df12d3). They pin the existing
 * public publishers, not private methods or a copied implementation.
 */
async function legacyPublications(hints?: DecisionHints) {
  const f = startupDialogService(hints);
  const ref = sessionRef(ACTIVE_SESSION_ID);
  const opening = f.service.start("/workspace");
  const trace: { path: string; statuses: { compacting: boolean; dialogs: number; response: ClientSessionStatus["response"] }[]; activities: { label: string; phase: string; detail?: string }[] }[] = [];
  let cursor = 0, activityCursor = 0;
  function record(path: string) {
    const frames = f.events.globalEvents.filter(event => event.type === "status.update");
    const activities = f.events.globalEvents.filter(event => event.type === "activity.update");
    trace.push({ path, activities: activities.slice(activityCursor).map(({ activity }) => ({ label: activity.label, phase: activity.phase, ...(activity.detail === undefined ? {} : { detail: activity.detail }) })), statuses: frames.slice(cursor).map(event => ({ compacting: event.status.isCompacting, dialogs: event.status.pendingDialogs?.length ?? 0, response: event.status.response })) });
    cursor = frames.length; activityCursor = activities.length;
    expect(f.events.sessionEvents.filter(({ event }) => event.type === "status.update")).toHaveLength(cursor);
  }
  try {
    await vi.waitFor(() => { expect(f.store.pendingDialogs(ACTIVE_SESSION_ID)).toHaveLength(1); });
    record("startup dialog");
    await f.service.answerDialog(ref, "dialog-1", true); await opening;
    record("startup answer and readiness");
    const ui = f.fake.calls.bindExtensions.at(-1)?.uiContext;
    if (ui === undefined) throw new Error("Missing extension UI context");
    const dialog = ui.confirm("Active dialog", "Continue?"); record("active dialog");
    await f.service.cancelDialog(ref, "dialog-2"); await dialog; record("dialog cancel");
    f.service.publishPullWatchStatus(ACTIVE_SESSION_ID); record("PR watch");
    const report = f.fake.calls.bindExtensions.at(-1)?.onError;
    if (report === undefined) throw new Error("Missing existing extension error callback");
    report({ extensionPath: "existing-extension", event: "tool_call", error: "base error" }); record("existing extension error");
    f.fake.emit({ type: "processes.update" }); record("process observer");
    f.fake.emit({ type: "workflow_runs_changed" }); record("gate observer");
    f.fake.emit({ type: "durable_children_changed" }); record("child observer");
    await f.service.runCommand(ref, "/compact");
    await vi.waitFor(() => { expect(f.events.sessionEvents.some(({ event }) => event.type === "command.output" && event.level === "success")).toBe(true); });
    record("compaction lifecycle");
    await f.service.shell(ref, "!printf compatibility");
    await vi.waitFor(() => { expect(f.events.sessionEvents.some(({ event }) => event.type === "shell.end")).toBe(true); });
    record("host shell lifecycle");
    f.fake.emit({ type: "agent_end" }); record("agent end");
    await f.service.stop(ref);
    // Base has this delayed legacy publication even after Stop. Do not change
    // that separate stale-runtime policy as part of optional Decision hints.
    await new Promise(resolve => setTimeout(resolve, 300)); record("delayed legacy completion after stop");
    report({ extensionPath: "existing-extension", event: "tool_call", error: "base error after stop" }); record("legacy extension error after stop");
    expect(f.events.sessionEvents.filter(({ event }) => event.type === "session.error")).toHaveLength(2);
    return { observe: () => trace, dispose: () => f.service.dispose() };
  } catch (error) { await f.service.dispose(); await Promise.allSettled([opening]); throw error; }
}

it("preserves main publications with hints absent, off, unconfigured or unavailable", async () => {
  await assertDecisionHintOffEquivalence(async ({ client, settings }) => {
    const run = await legacyPublications(client === undefined ? undefined : { client, readSettings: () => settings, status: () => ({ keyPresent: false as const, source: "none" as const }) });
    try {
      const trace = run.observe();
      expect(trace.map(step => [step.path, step.statuses.length])).toEqual([
        ["startup dialog", 1], ["startup answer and readiness", 2], ["active dialog", 1], ["dialog cancel", 1],
        ["PR watch", 1], ["existing extension error", 0], ["process observer", 1], ["gate observer", 1], ["child observer", 2],
        ["compaction lifecycle", 4], ["host shell lifecycle", 1], ["agent end", 1], ["delayed legacy completion after stop", 1], ["legacy extension error after stop", 0],
      ]);
      expect(trace[0]?.statuses).toMatchObject([{ dialogs: 1 }]);
      return run;
    } catch (error) { await run.dispose(); throw error; }
  });
});
