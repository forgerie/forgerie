// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RecapData } from "@shared/sessionRecap";
import { RecapEntry } from "./RecapEntry";
import { RecapRequest } from "./RecapRequest";
import { RecapPanel } from "../ui/RecapPanel";
import { fromHistory, convertMessage } from "../transcript";
import { recapNeeds, recapOf, recapSource } from "./recapModel";
import type { GatedAction } from "../gatedActions/gatedActionsModel";

const data: RecapData = { goal: "Ship a fix", done: ["Implemented", "Tested"], left: ["Not deployed", "Check the installation"], next: null,
  trigger: "automatic", model: "provider/small", messageCount: 8, coversThroughEntryId: "8", runEndedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-01-01T00:10:00.000Z" };
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("uses the molecule, its computed summary and source, and removes live Needs you when resolved", async () => {
  await act(async () => root.render(<RecapEntry data={data} needs="Approve the push" />));
  expect(document.querySelector('section[aria-label="While you were away"]')).not.toBeNull();
  expect(document.querySelector(".recap-panel-summary")?.textContent).toBe("2 done, 2 left");
  expect(document.querySelector(".recap-panel-needs")?.textContent).toContain("Approve the push");
  expect(document.querySelector(".afterword-source")?.textContent).toBe("Written by provider/small from the last 8 messages, 10 minutes after this run ended unread.");
  await act(async () => root.render(<RecapEntry data={data} />));
  expect(document.querySelector(".recap-panel-needs")).toBeNull();
  expect(document.querySelector(".recap-panel-summary")?.textContent).toBe("2 done, 2 left, nothing needs you");
  expect(document.querySelector('[data-field="next"]')).toBeNull();
});
it("keeps recap markdown fences backward compatible", async () => {
  await act(async () => root.render(<RecapPanel code={"goal: Fix it\ndone: Implemented\nneeds you: Approve\nnext: Deploy"} />));
  expect(document.querySelector('section[aria-label="Where we are"]')).not.toBeNull();
  expect(document.querySelector(".recap-panel-needs")?.textContent).toContain("Approve");
});
it("shows one writing line and live tally, then a short error instead", async () => {
  await act(async () => root.render(<RecapRequest state={{ kind: "writing" }} />));
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Writing a recap of the last 8 messages…");
  expect(document.querySelector('.block-run-block[data-tone="live"]')).not.toBeNull();
  expect(document.querySelector(".recap-panel")).toBeNull();
  await act(async () => root.render(<RecapRequest state={{ kind: "failed", message: "Could not write a recap. Try /recap again." }} />));
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try /recap again");
});
it("projects a recap as a system artifact and retains it after a new user message", () => {
  const message = { role: "custom", customType: "forgerie.recap", content: "While you were away", details: { ...data, forgerieDurableEntryId: 9 } };
  expect(recapOf(message)).toEqual(data);
  const transcript = fromHistory([message, { role: "user", content: "Continue" }]);
  expect(transcript.messages.map(message => message.role)).toEqual(["system", "user"]);
  expect(convertMessage(transcript.messages[0]!).metadata?.custom).toEqual({ recap: data });
  expect(recapSource({ ...data, trigger: "manual" })).toBe("Written by provider/small from the last 8 messages.");
});
it("derives reader obligations live from gates, forms, child questions and workflow stops", () => {
  const record: GatedAction = { id: "g1", conversationId: 1, by: "parent", tool: "bash", args: {}, category: "push-default", description: "git push origin main", requestedAt: 1, state: { kind: "waiting" } };
  expect(recapNeeds({ ask: { type: "none" }, waiting: [], records: [record], children: [], runs: [] })).toBe("Approve git push origin main");
  expect(recapNeeds({ ask: { type: "none" }, waiting: [], records: [{ ...record, state: { kind: "approved" } }], children: [], runs: [] })).toBe("");
  const needs = recapNeeds({ ask: { type: "open", ask: { askId: "ask", askedAt: "now", questions: [] }, phase: { type: "answering" } }, waiting: [], children: [{ name: "worker", agent: null, busy: false, createdAt: 1, conversationId: 2,
    questions: [{ questionId: "q", question: "May I delete the data?", askedAt: 1 }] }], runs: [{ id: "run", requestId: "req", startedAt: 1, definition: { name: "ship", path: "/workflow", sha256: "hash", text: "" },
    inputs: {}, state: { kind: "running" }, children: [], stops: { review: { state: "waiting" } } }] });
  expect(needs).toContain("Answer the open question form."); expect(needs).toContain("worker: May I delete the data?"); expect(needs).toContain("Decide at review");
});
