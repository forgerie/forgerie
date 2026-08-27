// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView thinking inside a step fold", () => {
  // The fold that hides the step is the only disclosure the reader needs. A
  // nested `thinking` fold under it cost a second click to read one thought.
  it("renders thinking as a flat row instead of a fold inside a fold", async () => {
    const view = await renderThinking("weighing two options");

    const section = requiredElement(view.shadowRoot?.querySelector(".group-msg"), "grouped step");
    expect(section.querySelector("details")).toBeNull();
    const thinking = requiredElement(section.querySelector(".rail-thinking"), "thinking row");
    expect(thinking.querySelector(".rail-activity-label")?.textContent).toBe("Thinking:");
    expect(Reflect.get(requiredElement(thinking.querySelector("formatted-text"), "thinking text"), "text")).toBe("weighing two options");
  });

  // ASSISTANT above a row already labelled "Thinking:" names nothing new.
  it("drops the role label above a thinking-only step", async () => {
    const view = await renderThinking("weighing two options");

    const section = requiredElement(view.shadowRoot?.querySelector(".group-msg"), "grouped step");
    expect(section.querySelector(".msg-header")).toBeNull();
  });

  it("leaves the step fold as the single disclosure of the turn", async () => {
    const view = await renderThinking("weighing two options");

    const disclosures = view.shadowRoot?.querySelectorAll("details") ?? [];
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.classList.contains("event-group")).toBe(true);
  });
});

async function renderThinking(text: string): Promise<ChatView> {
  const message: ChatLine = { role: "assistant", parts: [{ type: "thinking", text }] };
  const view = new ChatView();
  view.sessionId = "test-session";
  view.messages = [message];
  document.body.append(view);
  await view.updateComplete;
  await openTurnFold(view);
  return view;
}

/** Open the fold the way a reader would, so the component decides what open means. */
async function openTurnFold(view: ChatView): Promise<void> {
  const fold = requiredElement(view.shadowRoot?.querySelector("details.event-group"), "turn fold");
  fold.setAttribute("open", "");
  fold.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
