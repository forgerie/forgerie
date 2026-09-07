// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { normalizeMessages } from "../chatMessages";
import type { HandoffDoor } from "../handoffDoor";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

const skillPrompt = "<skill name=\"handoff\" location=\"/skills/handoff/SKILL.md\">\nCall handoff_session immediately.\n</skill>\n\nslow first full-library startup";

function handoffTurn(details: Record<string, unknown>, isError = false): ChatLine[] {
  return normalizeMessages([
    { role: "user", content: skillPrompt },
    { role: "assistant", content: [{ type: "toolCall", id: "handoff-1", name: "handoff_session", arguments: { focus: "slow first full-library startup" } }] },
    { role: "toolResult", toolCallId: "handoff-1", toolName: "handoff_session", content: [{ type: "text", text: "Started detached handoff." }], details, isError },
  ]);
}

async function transcript(messages: ChatLine[], sessionCwd = "/home/me/code/pyxis"): Promise<{ view: ChatView; opened: HandoffDoor[] }> {
  const opened: HandoffDoor[] = [];
  const view = new ChatView();
  view.sessionId = "session-1";
  view.sessionCwd = sessionCwd;
  view.messages = messages;
  view.onOpenSession = (door) => { opened.push(door); };
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return { view, opened };
}

function shadow(view: ChatView): ShadowRoot {
  if (view.shadowRoot === null) throw new Error("The transcript did not render");
  return view.shadowRoot;
}

function door(view: ChatView): HTMLElement | null {
  return shadow(view).querySelector<HTMLElement>(".msg.user .command-door");
}

describe("the door on a turn that created a session", () => {
  it("stands in the command bubble and opens the session it names", async () => {
    const { view, opened } = await transcript(handoffTurn({ destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }));

    const control = door(view);
    if (control === null) throw new Error("The turn rendered no door");
    control.click();

    expect(opened).toEqual([{ sessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }]);
  });

  it("names the destination workspace only when it is not the one being read", async () => {
    const same = await transcript(handoffTurn({ destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }));
    expect(door(same.view)?.querySelector(".command-door-where")).toBeNull();

    const elsewhere = await transcript(handoffTurn({ destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis/.worktree/sonos" }));
    expect(elsewhere.view.shadowRoot?.querySelector(".command-door-where")?.textContent).toBe("sonos");
  });

  it("opens no door on a handoff that failed, and leaves the failure to the rail", async () => {
    const { view } = await transcript(handoffTurn({}, true));

    expect(door(view)).toBeNull();
  });

  it("opens no door on an ordinary skill turn", async () => {
    const { view } = await transcript(normalizeMessages([{ role: "user", content: "<skill name=\"se-work\" location=\"/skills/se-work/SKILL.md\">\nExecute work.\n</skill>\n\nship it" }]));

    expect(door(view)).toBeNull();
  });

  it("carries a label naming the session, so the arrow is not the only cue", async () => {
    const { view } = await transcript(handoffTurn({ destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }));

    expect(door(view)?.getAttribute("aria-label")).toBe("Open the session this handoff created");
  });
});

describe("the rail under a turn that created a session", () => {
  /** The register's text lives in turn-rail-summary's own shadow root. */
  function railText(view: ChatView): string {
    const register = shadow(view).querySelector("turn-rail-summary");
    return (register?.shadowRoot?.textContent ?? "").replace(/\s+/gu, " ").trim();
  }

  it("disappears, because the door already reported the only call the turn made", async () => {
    const { view } = await transcript(handoffTurn({ destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }));

    expect(shadow(view).querySelector(".turn-rail")).toBeNull();
  });

  it("still counts the work the door did not take", async () => {
    const messages = normalizeMessages([
      { role: "user", content: skillPrompt },
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "docs/plan.md" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false },
      { role: "assistant", content: [{ type: "toolCall", id: "handoff-1", name: "handoff_session", arguments: { focus: "x" } }] },
      { role: "toolResult", toolCallId: "handoff-1", toolName: "handoff_session", content: [{ type: "text", text: "Started." }], details: { destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" }, isError: false },
    ]);
    const { view } = await transcript(messages);

    expect(railText(view)).toContain("1 step");
    expect(railText(view)).not.toContain("2 steps");
  });

  it("keeps a failed handoff, which has no door and no other place to be reported", async () => {
    const { view } = await transcript(handoffTurn({}, true));

    expect(shadow(view).querySelector(".turn-rail")).not.toBeNull();
    expect(railText(view)).toContain("unresolved");
  });
});
