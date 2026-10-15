import { expect, it } from "vitest";
import { assertDecisionHintOffEquivalence } from "../../../src/server/decisions/decisionHintsOffEquivalence.testSupport";
import { AttentionHints, type AttentionSession } from "../../../src/server/decisions/attentionHints";
import { applyCatalogEvent, type CatalogState } from "./catalogStore";
import { parseCatalogEvent } from "./contracts";
import { rows, sections, type BoardInput } from "./board";

const idle = { sessionId: "a", isStreaming: false, isCompacting: false, isBashRunning: false };
const now = new Date("2026-10-14T12:00:00Z").getTime();
const state: CatalogState = { connection: { type: "ready" }, sessions: [{ id: "a", cwd: "/code", modified: new Date(now).toISOString() }], statuses: {}, activities: {}, unread: new Set(["a"]), projects: [] };
const input = (catalog: CatalogState): BoardInput => ({ ...catalog, now, locate: () => ({ projectKey: "p", project: "p" }) });
it("keeps picker observations identical without configured reachable attention hints, without waiting for a hanging gateway", async () => {
  await assertDecisionHintOffEquivalence(({ client, settings }) => {
    let catalog = state;
    const hints = new AttentionHints(client === undefined ? undefined : { client, readSettings: () => settings, status: () => ({ keyPresent: false }) }, (error) => { throw error; }, () => new Date(now));
    const session: AttentionSession = { branch: () => [{ id: "turn-1", type: "message", message: { role: "assistant" } }], messages: () => [{ role: "assistant", content: [{ type: "text", text: "Please review." }] }], awaiting: () => "nothing", persist: () => Promise.resolve("stored"), publish: () => update() };
    function update() { catalog = applyCatalogEvent(catalog, { type: "status.update", status: { ...idle, response: { kind: "none" }, attentionHint: hints.read(session) } }); }
    update(); hints.settled(session);
    return { observe: () => ({ rows: rows(input(catalog)), sections: sections(rows(input(catalog)), { grouping: "state", showArchived: false, now }) }) };
  });
});
it("carries server-selected hint data through status.update and drops it after new input", () => {
  const event = parseCatalogEvent({ type: "status.update", status: { ...idle, attentionHint: { turnId: "turn-1", model: "fast", at: new Date(now).toISOString(), likelyNeedsYou: true, kind: "review", urgency: "high" } } });
  if (!event) throw new Error("Missing status event");
  const promoted = applyCatalogEvent(state, event);
  expect(rows(input(promoted))[0]).toMatchObject({ state: "blocked", likelyNeedsYou: true, attentionKind: "review", urgency: "high" });
  const cleared = applyCatalogEvent(promoted, { type: "status.update", status: { ...idle, response: { kind: "none" } } });
  expect(rows(input(cleared))[0]).toMatchObject({ state: "unread" });
  expect(rows(input(cleared))[0]).not.toHaveProperty("attentionKind");
});
