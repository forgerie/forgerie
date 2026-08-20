// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A queued command is going to run, not read as prose, so its ghost wears the
 * command mark. Plain prose keeps the formatted-text path untouched.
 */
describe("ChatView queued command marks", () => {
  it("marks queued commands and leaves prose as formatted text", async () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    view.clientQueuedMessages = [
      { kind: "followUp", text: "/tree" },
      { kind: "followUp", text: "/relay fix the flaky test" },
      { kind: "followUp", text: "plain prose follow-up" },
    ];
    document.body.append(view);
    await view.updateComplete;

    const queued = Array.from(view.shadowRoot?.querySelectorAll(".queued-message") ?? []);
    expect(queued).toHaveLength(3);

    const bare = queued[0]?.querySelector(".command-mark");
    expect(bare?.querySelector(".command-sigil")?.textContent).toBe("/");
    expect(bare?.querySelector(".command-name")?.textContent).toBe("tree");
    expect(queued[0]?.querySelector("formatted-text")).toBeNull();
    expect(queued[0]?.querySelector(".queued-command-rest")).toBeNull();

    expect(queued[1]?.querySelector(".command-mark .command-name")?.textContent).toBe("relay");
    expect(queued[1]?.querySelector(".queued-command-rest")?.textContent).toBe("fix the flaky test");

    expect(queued[2]?.querySelector(".command-mark")).toBeNull();
    expect(queued[2]?.querySelector<HTMLElement & { text: string }>("formatted-text")?.text).toBe("plain prose follow-up");
  });
});
