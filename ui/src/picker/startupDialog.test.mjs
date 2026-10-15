// Cross-stack Node acceptance: the server SDK uses the server TypeScript config.
import { expect, it, vi } from "vitest";
import { startupDialogService, ACTIVE_SESSION_ID } from "../../../src/server/sessions/piSessionService.extensionDialogs.testSupport";
import { readDecisionHintsSettings } from "../../../src/server/decisions/decisionHintsSettings";
import { parseCatalogEvent } from "./contracts";
import { applyCatalogEvent } from "./catalogStore";
import { rows } from "./board";

it.each(["absent", "present"])("a real session_start dialog publication makes the picker row blocked (hints %s)", async mode => {
  const hints = mode === "absent" ? undefined : { client: { ask: () => Promise.resolve(undefined) }, readSettings: () => ({ ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" }), status: () => ({ keyPresent: false }) };
  const f = startupDialogService(hints);
  const starting = f.service.start("/workspace");
  try {
    await vi.waitFor(() => { expect(f.store.pendingDialogs(ACTIVE_SESSION_ID)).toHaveLength(1); });
    const state = { connection: { type: "ready" }, sessions: [{ id: ACTIVE_SESSION_ID, cwd: "/workspace", modified: "2026-10-14T00:00:00Z" }], statuses: {}, activities: {}, unread: new Set(), projects: [] };
    const events = f.events.globalEvents.filter(event => event.type === "status.update");
    expect(events).toHaveLength(1);
    let catalog = state;
    for (const event of events) {
      const parsed = parseCatalogEvent(event); if (parsed === undefined) throw new Error("Missing picker status event");
      catalog = applyCatalogEvent(catalog, parsed);
    }
    expect(rows({ ...catalog, now: Date.parse("2026-10-14T00:00:00Z"), locate: () => ({ projectKey: "workspace", project: "workspace" }) })[0]).toMatchObject({ state: "blocked", group: "blocked" });
  } finally { await f.service.dispose(); await Promise.allSettled([starting]); }
});
