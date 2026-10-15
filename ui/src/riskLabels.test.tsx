// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import { Check } from "typebox/value";
import { RISK_LABEL_ENTRY_KIND, RiskLabelSchema, type RiskLabel } from "@shared/riskLabels";
import { riskLabelSchema } from "./riskLabelsModel";
import { fromHistory, reduceEvent, convertMessage } from "./transcript";
import type { PiMessage } from "./contracts";
import { GatedActionCard } from "./gatedActions/GatedActionCard";
import { PUSH, PUSH_ENTRY } from "./gatedActions/fixtures/gatedActions";
import { ToolCall } from "./ui/Trace";
import { ExchangeLog } from "./ui/ExchangeLog";
import { exchangeLines } from "./childAgents/childExchange";

const label: RiskLabel = {model: "answering-model", deletes_data: 0.8, outside_worktree: 0.2, acts_as_user: 0.4, risk: "check", risk_score: 1.3};
const call: PiMessage = {role: "assistant", toolInvocations: {"bash-1": "first-invocation"}, content: [{type: "toolCall", id: "bash-1", name: "bash", arguments: {command: "rm data"}}]};
const annotation = (target: "gate" | "tool", id: string): PiMessage => ({role: "custom", customType: RISK_LABEL_ENTRY_KIND,
  details: {target, id, label, ...(target === "tool" ? {invocationId: "first-invocation", sourceInvocationId: "first-invocation"} : {})}, content: "Risk opinion (not approval)"});

let root: Root;
beforeEach(() => {vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div")));});
afterEach(async () => {await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals();});

it("keeps the browser and server risk-label wire contracts equal", () => {
  expectTypeOf<ReturnType<typeof riskLabelSchema.parse>>().toEqualTypeOf<RiskLabel>();
  for (const value of [label, {...label, model: ""}, {...label, risk: "safe"}, {...label, risk_score: 3}, {...label, deletes_data: -1}, {...label, approval: true}]) {
    expect(riskLabelSchema.safeParse(value).success).toBe(Check(RiskLabelSchema, value));
  }
});
it("folds the live and reloaded label into the same tool without changing its execution state or row count", async () => {
  const initial = fromHistory([call], true);
  const live = reduceEvent(initial, {type: "message.end", message: annotation("tool", "bash-1")});
  expect(live.messages).toHaveLength(1); expect(live.messages[0]?.parts[0]).toEqual({...initial.messages[0]?.parts[0], riskLabel: label});
  expect(live.liveId).toBe(initial.liveId); expect(live.isRunning).toBe(initial.isRunning);
  const history = fromHistory([call, annotation("tool", "bash-1")], true);
  expect(history.messages).toEqual(live.messages);
  const converted = convertMessage(live.messages[0]!);
  expect(converted.content[0]).toMatchObject({type: "tool-call", toolCallId: "first-invocation", artifact: {state: "pending", riskLabel: label}});
  await act(async () => root.render(<ToolCall toolCallId="bash-1" toolName="bash" args={{command: "rm data"}} artifact={{state: "pending", riskLabel: label}} />));
  expect(JSON.parse(document.querySelector(".tool-call")?.getAttribute("data-risk-label") ?? "null")).toEqual(label);
  expect(document.body.textContent).not.toContain("safe");
});
it("a gate label leaves both choices unchanged, and stays in the closed/history card", async () => {
  const approve = vi.fn(); const refuse = vi.fn();
  await act(async () => root.render(<GatedActionCard entry={PUSH_ENTRY} record={{...PUSH, riskLabel: label}} read onApprove={approve} onRefuse={refuse} />));
  expect(JSON.parse(document.querySelector("[data-risk-label]")?.getAttribute("data-risk-label") ?? "null")).toEqual(label);
  const buttons = [...document.querySelectorAll("button")];
  await act(async () => buttons.find(node => node.textContent === "Approve and run")?.click());
  await act(async () => buttons.find(node => node.textContent === "Refuse")?.click());
  expect(approve).toHaveBeenCalledOnce(); expect(refuse).toHaveBeenCalledOnce();
  const gateMessage: PiMessage = {role: "custom", customType: "forgerie.gated-action", details: PUSH_ENTRY};
  const history = fromHistory([gateMessage, annotation("gate", PUSH_ENTRY.id)]);
  expect(history.messages).toHaveLength(1); expect(history.messages[0]?.gatedAction?.riskLabel).toEqual(label);
  await act(async () => root.render(<GatedActionCard entry={history.messages[0]!.gatedAction!} record={{...PUSH, state: {kind: "refused"}}} read />));
  expect(document.querySelector("[data-risk-label]")).not.toBeNull(); expect(document.body.textContent).toContain("Refused");
});
it("attaches a native child label by the child's call id to its existing bash row", async () => {
  const transcript = {messages: [call, annotation("tool", "bash-1")], busy: false};
  const lines = exchangeLines("helper", transcript);
  expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({kind: "call", name: "bash", riskLabel: label});
  await act(async () => root.render(<ExchangeLog lines={lines} empty="No messages" />));
  expect(JSON.parse(document.querySelector(".exchange-log-call")?.getAttribute("data-risk-label") ?? "null")).toEqual(label);
});
it("ignores invalid labels rather than changing tool state", () => {
  const initial = fromHistory([call]);
  expect(reduceEvent(initial, {type: "message.end", message: {...annotation("tool", "bash-1"), details: {target: "tool", id: "bash-1", label: {...label, risk: "safe to approve"}}}})).toBe(initial);
});

it("matches late labels by invocation identity when parent tool-call ids repeat across turns", () => {
  const first: PiMessage = {...call, toolInvocations: {"bash-1": "first"}, decisionAnnotations: [{target: "tool", id: "bash-1", invocationId: "first", sourceInvocationId: "first", label: {...label, model: "FIRST"}}]};
  const second: PiMessage = {...call, toolInvocations: {"bash-1": "second"}, content: [{type: "toolCall", id: "bash-1", name: "bash", arguments: {command: "printf SECOND"}}]};
  const initial = fromHistory([first, {role: "user", content: "next turn"}, second]);
  const latest: PiMessage = {role: "custom", customType: RISK_LABEL_ENTRY_KIND, details: {target: "tool", id: "bash-1", invocationId: "second", sourceInvocationId: "second", label: {...label, model: "SECOND"}}};
  const late: PiMessage = {...latest, details: {target: "tool", id: "bash-1", invocationId: "first", sourceInvocationId: "first", label: {...label, model: "late-FIRST"}}};
  const annotated = reduceEvent(reduceEvent(initial, {type: "message.end", message: latest}), {type: "message.end", message: late});
  const tools = annotated.messages.flatMap(message => message.parts).filter(part => part.type === "tool");
  expect(tools).toHaveLength(2); expect(tools.map(part => part.riskLabel?.model)).toEqual(["late-FIRST", "SECOND"]);
  expect(annotated.messages).toHaveLength(initial.messages.length);
  expect(annotated.messages.filter(message => message.role === "assistant").map(message => convertMessage(message).content[0])).toMatchObject([
    {toolCallId: "first"}, {toolCallId: "second"},
  ]);
  const off = fromHistory([{...first, decisionAnnotations: undefined}, {role: "user", content: "next turn"}, second]);
  expect(off.messages.flatMap(message => message.parts).filter(part => part.type === "tool").every(part => part.riskLabel === undefined)).toBe(true);
});
