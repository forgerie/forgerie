// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { TurnLedgerRow } from "../turnRail";
import { TurnRailLedger } from "./TurnRailLedger";
import type { ToolExecutionView } from "./ToolExecutionView";

afterEach(() => {
  document.body.replaceChildren();
});

const editExecution = {
  type: "toolExecution" as const,
  toolName: "edit",
  summary: "",
  args: { path: "/repo/TurnRailSummary.ts", edits: [{}, {}] },
  status: "success" as const,
  details: { diff: "+one\n+two\n-three" },
};

const rows: TurnLedgerRow[] = [
  {
    key: "edit-1",
    verb: "edit",
    target: "/repo/TurnRailSummary.ts",
    label: "TurnRailSummary.ts",
    outcome: "done",
    editCount: 2,
    added: 2,
    removed: 1,
    execution: editExecution,
  },
  {
    key: "read-1",
    verb: "read",
    target: "/repo/turnRail.ts",
    label: "turnRail.ts",
    outcome: "done",
    added: 0,
    removed: 0,
    execution: { type: "toolExecution", toolName: "read", summary: "", args: { path: "/repo/turnRail.ts" }, status: "success" },
  },
  {
    key: "bash-1",
    verb: "bash",
    target: "npm run verify",
    label: "npm run verify",
    outcome: "failed",
    evidence: "vitest failed",
    added: 0,
    removed: 0,
    execution: { type: "toolExecution", toolName: "bash", summary: "", args: { command: "npm run verify" }, status: "error", resultText: "vitest failed" },
  },
];

async function mount(): Promise<TurnRailLedger> {
  const ledger = new TurnRailLedger();
  ledger.rows = rows;
  document.body.append(ledger);
  await ledger.updateComplete;
  return ledger;
}

function compactText(element: Element | ShadowRoot | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("TurnRailLedger", () => {
  it("renders one compact row per step with only meaningful quantities", async () => {
    const ledger = await mount();
    const summaries = [...(ledger.shadowRoot?.querySelectorAll("summary") ?? [])];

    expect(summaries).toHaveLength(3);
    expect(compactText(summaries[0] ?? null)).toContain("done edit TurnRailSummary.ts 2 edits +2/-1");
    expect(compactText(summaries[1] ?? null)).toBe("✓ done read turnRail.ts");
    expect(compactText(summaries[2] ?? null)).toContain("failed bash npm run verify failed");
  });

  it("opens the shipped tool detail without repeating its header", async () => {
    const ledger = await mount();
    const first = ledger.shadowRoot?.querySelector("details");
    if (!(first instanceof HTMLDetailsElement)) throw new Error("The ledger rendered no first row");
    first.open = true;
    first.dispatchEvent(new Event("toggle"));
    await ledger.updateComplete;

    const detail = first.querySelector<ToolExecutionView>("tool-execution-view");
    if (detail === null) throw new Error("The row rendered no tool detail");
    await detail.updateComplete;
    expect(detail.presentation).toBe("detail");
    expect(detail.shadowRoot?.querySelector(".tool-header")).toBeNull();
    expect(detail.shadowRoot?.querySelector(".diff-details")).not.toBeNull();
  });
});
