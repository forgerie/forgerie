// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { normalizeMessages } from "../chatMessages";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

const skillPrompt = "<skill name=\"handoff\" location=\"/skills/handoff/SKILL.md\">\nCall handoff_session immediately.\n</skill>\n\nslow first full-library startup";

async function transcript(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function shadow(view: ChatView): ShadowRoot {
  if (view.shadowRoot === null) throw new Error("The transcript did not render");
  return view.shadowRoot;
}

function commandBubble(view: ChatView): HTMLDetailsElement {
  const bubble = shadow(view).querySelector(".msg.user .skill-command");
  if (!(bubble instanceof HTMLDetailsElement)) throw new Error("The transcript rendered no skill command disclosure");
  return bubble;
}

describe("a skill invocation in the transcript", () => {
  it("reads as the command that was typed, not as a bracketed skill card", async () => {
    const view = await transcript(normalizeMessages([{ role: "user", content: skillPrompt }]));

    const bubble = commandBubble(view);
    expect(bubble.querySelector(".command-name")?.textContent).toBe("handoff");
    expect(bubble.querySelector(".command-sigil")?.textContent).toBe("/");
    expect(bubble.querySelector(".skill-command-argument")?.textContent).toBe("slow first full-library startup");
    expect(shadow(view).textContent).not.toContain("[skill]");
  });

  it("keeps the command and its argument in one turn", async () => {
    const view = await transcript(normalizeMessages([{ role: "user", content: skillPrompt }]));

    expect(shadow(view).querySelectorAll(".turn")).toHaveLength(1);
    expect(shadow(view).querySelectorAll(".msg.user")).toHaveLength(1);
  });

  it("keeps the skill's own text one tap away behind the mark", async () => {
    const view = await transcript(normalizeMessages([{ role: "user", content: skillPrompt }]));

    const bubble = commandBubble(view);
    expect(bubble.open).toBe(false);
    expect(bubble.querySelector("summary")?.querySelector(".command-mark")).not.toBeNull();
    expect(bubble.querySelector(".skill-command-body small")?.textContent).toBe("/skills/handoff/SKILL.md");
    const skillText = bubble.querySelector<HTMLElement & { text?: string }>(".skill-command-body formatted-text");
    expect(skillText?.text).toBe("Call handoff_session immediately.");
  });

  it("renders a skill invoked with no argument as the bare command", async () => {
    const bare = "<skill name=\"se-work\" location=\"/skills/se-work/SKILL.md\">\nExecute work.\n</skill>";
    const view = await transcript(normalizeMessages([{ role: "user", content: bare }]));

    const bubble = commandBubble(view);
    expect(bubble.querySelector(".command-name")?.textContent).toBe("se-work");
    expect(bubble.querySelector(".skill-command-argument")).toBeNull();
  });
});
