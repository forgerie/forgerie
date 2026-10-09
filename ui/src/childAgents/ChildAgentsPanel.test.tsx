// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildAgentsPanel, type ChildAgentsActions } from "./ChildAgentsPanel";
import { ChildEntryView } from "./ChildEntryView";
import { CHILDREN, STREAMING, TRANSCRIPT } from "./fixtures/children";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const actions = (): ChildAgentsActions => ({ onOpenChild: vi.fn(), onBack: vi.fn(), onClose: vi.fn(), onSend: vi.fn(() => Promise.resolve()),
  onStop: vi.fn(), onAnswer: vi.fn(() => Promise.resolve()) });
const fields = () => [...document.querySelectorAll("textarea")].map((field) => field.getAttribute("aria-label"));
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text);

describe("child agents panel", () => {
  it("offers one input: the answer while a question is open, shown as a card where it was asked", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={21} transcript={TRANSCRIPT} actions={actions()} />));
    expect(fields()).toEqual(["Answer ui: Should the empty state show the last run, or stay blank?"]);
    expect(document.querySelectorAll(".question-card")).toHaveLength(1);
    // The question is a card, not a tool line.
    expect([...document.querySelectorAll(".exchange-log-name")].map((node) => node.textContent)).toEqual(["read"]);
  });

  it("steers a working child, with Stop in the header", async () => {
    const handlers = actions();
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={15} transcript={STREAMING} actions={handlers} />));
    expect(fields()).toEqual(["Message api"]);
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Steer api while it works");
    await act(async () => { button("Stop")?.click(); });
    expect(handlers.onStop).toHaveBeenCalledWith(15);
    expect(document.querySelector(".exchange-log-out")?.hasAttribute("data-streaming")).toBe(true);
  });

  it("gives an idle child a new task, without Stop", async () => {
    await act(async () => root.render(<ChildAgentsPanel children={CHILDREN} openId={33} transcript={{ ...TRANSCRIPT, messages: TRANSCRIPT.messages.slice(0, 3), busy: false }} actions={actions()} />));
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Give review another task");
    expect(button("Stop")).toBeUndefined();
  });

  it("shows a report's first line in the text face, with the rest on request", async () => {
    await act(async () => root.render(<ChildEntryView entry={{ kind: "report", childName: "api", outcome: "answered", text: "**Added** GET /api/runs.\n\nTests: 14 passed." }} />));
    expect(document.querySelector(".event-line-quote")?.textContent).toBe("Added GET /api/runs.");
    expect(document.querySelector(".event-line-quote")?.getAttribute("data-face")).toBe("text");
    expect(document.querySelector(".event-line-detail")?.textContent).toContain("Tests: 14 passed.");
  });
});
