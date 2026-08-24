// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine, ToolExecutionPart } from "./shared";
import type { TurnRailSummary } from "./TurnRailSummary";

afterEach(() => {
  document.body.replaceChildren();
});

const repositoryPath = "/home/simonwjackson/code/sandbox/fullscreen-browser/app/src/main/kotlin/com/simonwjackson/fullscreenbrowser/ExtensionPackageRepository.kt";

function said(role: ChatLine["role"], text: string): ChatLine {
  return { role, parts: [{ type: "text", text }] };
}

/** A tool line in the shape `chatTranscript` builds from the wire. */
function ran(toolName: string, status: ToolExecutionPart["status"], args: unknown, extra: Partial<ToolExecutionPart> = {}): ChatLine {
  return { role: "tool", parts: [{ type: "toolExecution", toolName, summary: "", status, args, ...extra }] };
}

async function transcript(messages: ChatLine[], live = false): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  if (live) {
    view.activity = { sessionId: "session-1", phase: "active", label: "running tool", at: "2026-08-24T10:00:00.000Z" };
  }
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function shadow(view: ChatView): ShadowRoot {
  if (view.shadowRoot === null) throw new Error("The transcript did not render");
  return view.shadowRoot;
}

function summary(view: ChatView): TurnRailSummary {
  const element = shadow(view).querySelector<TurnRailSummary>("turn-rail-summary");
  if (element === null) throw new Error("The rail rendered no collapsed register");
  return element;
}

function summaryText(view: ChatView): string {
  return (summary(view).shadowRoot?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function ledger(view: ChatView): HTMLElement {
  const element = shadow(view).querySelector<HTMLElement>(".rail-ledger");
  if (element === null) throw new Error("The rail rendered no step ledger");
  return element;
}

const failedEdit = ran("edit", "error", { path: repositoryPath, edits: [1, 2] }, {
  resultText: `Found 2 occurrences of edits[0] in ${repositoryPath}. Each oldText must be unique.`,
});
const succeededEdit = ran("edit", "success", { path: repositoryPath }, { details: { diff: "+one\n+two\n-three" } });

describe("ChatView quiet rail", () => {
  it("collapses a finished turn's steps into one receipt", async () => {
    const view = await transcript([
      said("user", "add the digest budget"),
      failedEdit,
      ran("read", "success", { path: "/home/simonwjackson/code/sandbox/fullscreen-browser/app/src/" }),
      succeededEdit,
      said("assistant", "the answer"),
    ]);

    const text = summaryText(view);
    expect(text).toContain("3 steps");
    expect(text).toContain("2 files");
    expect(text).toContain("1 retry");
    expect(ledger(view).hidden).toBe(true);
  });

  it("keeps the collapsed receipt free of the absolute path", async () => {
    const view = await transcript([said("user", "q"), succeededEdit, said("assistant", "the answer")]);

    expect(summaryText(view)).not.toContain(repositoryPath);
  });

  it("opens the ledger in place when the reader asks for it", async () => {
    const view = await transcript([said("user", "q"), succeededEdit, said("assistant", "the answer")]);
    const disclosure = summary(view).shadowRoot?.querySelector("button.disclosure");
    if (!(disclosure instanceof HTMLButtonElement)) throw new Error("The register rendered no disclosure");

    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    disclosure.click();
    await view.updateComplete;
    await view.updateComplete;

    expect(ledger(view).hidden).toBe(false);
    expect(summary(view).shadowRoot?.querySelector("button.disclosure")?.getAttribute("aria-expanded")).toBe("true");
    expect(ledger(view).querySelector("details.event-group")).not.toBeNull();
  });

  it("pins the failure it has not recovered from while the turn works", async () => {
    const view = await transcript([
      said("user", "add the digest budget"),
      failedEdit,
      ran("read", "running", { path: "/home/simonwjackson/code/sandbox/fullscreen-browser/app/src/" }),
    ], true);

    const text = summaryText(view);
    expect(text).toContain("edit");
    expect(text).toContain("ExtensionPackageRepository.kt");
    expect(text).toContain("Found 2 occurrences of edits[0].");
    expect(text).toContain("2 steps");
  });

  it("leaves naming the running step to the transcript's liveness row", async () => {
    const view = await transcript([
      said("user", "add the digest budget"),
      ran("read", "running", { path: "/repo/only-in-the-running-step.ts" }),
    ], true);

    expect(summaryText(view)).not.toContain("only-in-the-running-step.ts");
  });

  it("drops the pin once the same edit lands, keeping it as a retry", async () => {
    const view = await transcript([
      said("user", "add the digest budget"),
      failedEdit,
      succeededEdit,
      ran("read", "running", { path: "/repo/other.ts" }),
    ], true);

    const text = summaryText(view);
    expect(text).toContain("1 retry");
    expect(text).not.toContain("Found 2 occurrences");
  });

  it("leaves narration-only work in the ledger, with nothing to summarise", async () => {
    const view = await transcript([
      said("user", "q"),
      said("assistant", "partway there"),
      said("assistant", "the answer"),
    ]);

    expect(shadow(view).querySelector("turn-rail-summary")).toBeNull();
    expect(ledger(view).hidden).toBe(false);
  });
});
