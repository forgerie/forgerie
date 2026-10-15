// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskLabel } from "@shared/riskLabels";
import { riskWords, RISK_SIGNAL_RAISED } from "./riskLabelsModel";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { TranscriptMessage } from "./transcript";
import { useThreadMessages } from "./useThreadMessages";
import { Thread } from "./ui/Thread";
import { GatedActionCard } from "./gatedActions/GatedActionCard";
import { gatedMeta } from "./gatedActions/gatedActionsModel";
import { PUSH, PUSH_ENTRY, PUSH_REFUSED, RISK_CHECK, RISK_DANGER, RISK_LOW } from "./gatedActions/fixtures/gatedActions";

let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const card = (record = PUSH) => act(async () => root.render(<GatedActionCard entry={PUSH_ENTRY} record={record} read onApprove={() => {}} onRefuse={() => {}} />));
const buttons = () => [...document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("risk words", () => {
  it("name only the raised signals, and never call low risk safe", () => {
    expect(riskWords(RISK_LOW)).toEqual({ level: "low", word: "Low risk", reasons: [], source: "Opinion from fast" });
    expect(riskWords(RISK_DANGER).reasons).toEqual(["deletes data", "outside the working directory"]);
    const edge: RiskLabel = { ...RISK_CHECK, deletes_data: RISK_SIGNAL_RAISED, outside_worktree: RISK_SIGNAL_RAISED - 0.01, acts_as_user: 1 };
    expect(riskWords(edge).reasons).toEqual(["deletes data", "acts as you"]);
    for (const label of [RISK_LOW, RISK_CHECK, RISK_DANGER]) expect(JSON.stringify(riskWords(label))).not.toMatch(/safe|approv/i);
  });
});

describe("the gate card's risk badge", () => {
  it("adds nothing without a label", async () => {
    await card();
    expect(document.querySelector(".risk-badge, .decision-card-annotation, [data-risk-label]")).toBeNull();
    expect(document.querySelector(".decision-card-meta")?.innerHTML).toBe(gatedMeta(PUSH_ENTRY));
    expect(buttons()).toEqual(["Copy command", "Refuse", "Approve and run"]);
  });
  it("says each level in words with its signals and source, right above unchanged choices", async () => {
    const cases = [
      [RISK_LOW, "low", "Low risk. Opinion from fast."],
      [RISK_CHECK, "check", "Check first: acts as you. Opinion from fast."],
      [RISK_DANGER, "danger", "High risk: deletes data, outside the working directory. Opinion from fast."],
    ] as const;
    for (const [label, level, sentence] of cases) {
      await card({ ...PUSH, riskLabel: label });
      const badge = document.querySelector<HTMLElement>(".decision-card-annotation .risk-badge")!;
      expect(badge.dataset["level"]).toBe(level);
      expect(badge.textContent).toBe(sentence);
      expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(document.body.textContent).not.toMatch(/safe|approved/i);
      // In the flow just above the choices, which keep their words and order.
      expect(document.querySelector(".decision-card-annotation")?.nextElementSibling?.className).toBe("decision-card-foot");
      expect(buttons()).toEqual(["Copy command", "Refuse", "Approve and run"]);
    }
  });
  it("keeps the opinion once the card closes", async () => {
    await card({ ...PUSH_REFUSED, riskLabel: RISK_CHECK });
    expect(document.querySelector(".risk-badge")?.textContent).toContain("Check first");
    expect(document.body.textContent).toContain("Refused");
  });
});

describe("the bash line's risk badge", () => {
  const message = (riskLabel?: RiskLabel): TranscriptMessage => ({ id: "a", role: "assistant", parts: [{
    type: "tool", id: "bash-1", name: "bash", args: { command: "rm -rf dist" }, state: { type: "done", output: "", isError: false }, ...(riskLabel ? { riskLabel } : {}) }] });
  function Fixture({ messages }: { messages: TranscriptMessage[] }) {
    const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {}, isRunning: false });
    return <AssistantRuntimeProvider runtime={runtime}><Thread /></AssistantRuntimeProvider>;
  }
  // A reply's calls fold behind its tally; the reader opens it to see each call's line.
  async function draw(riskLabel?: RiskLabel) {
    await act(async () => root.render(<Fixture messages={[message(riskLabel)]} />));
    await act(async () => document.querySelector<HTMLButtonElement>(".tally-toggle")?.click());
  }
  const line = () => document.querySelector<HTMLDetailsElement>("details.tool-call")!;
  it("adds nothing without a label", async () => {
    await draw();
    expect(document.querySelector(".risk-badge, [data-risk-label]")).toBeNull();
    expect(line().querySelector(":scope > summary")?.textContent).toBe(">ran bash rm -rf dist");
  });
  it("ends the line with the level, and says the signals and source to a screen reader and on hover", async () => {
    await draw(RISK_DANGER);
    const badge = line().querySelector<HTMLElement>(":scope > summary .risk-badge")!;
    expect(badge.dataset["size"]).toBe("inline");
    expect(badge.querySelector(".risk-badge-word")?.textContent).toBe("High risk");
    expect(badge.getAttribute("title")).toBe("High risk: deletes data, outside the working directory. Opinion from fast.");
    expect(line().querySelector(":scope > summary")?.textContent).toBe(">ran bash rm -rf distHigh risk: deletes data, outside the working directory. Opinion from fast.");
  });
  it("says the opinion in full when the line opens", async () => {
    await draw(RISK_LOW);
    const details = line();
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    const full = document.querySelector<HTMLElement>('section[aria-label="Risk opinion"] .risk-badge')!;
    expect(full.dataset["size"]).toBe("block");
    expect(full.textContent).toBe("Low risk. Opinion from fast.");
  });
});
