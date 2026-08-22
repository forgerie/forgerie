// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { FormattedText } from "./FormattedText";
import type { ChatLine } from "./shared";

const SQL = "```sql\nSELECT * FROM you\n```";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView fenced code rendering", () => {
  it("highlights user and assistant SQL blocks through the same transcript path", async () => {
    const view = new ChatView();
    view.sessionId = "markdown-code-session";
    view.messages = [textMessage("user", SQL), textMessage("assistant", SQL)];
    document.body.append(view);
    await view.updateComplete;
    await view.updateComplete;

    const user = formattedText(view, ".msg.user formatted-text");
    const assistant = formattedText(view, ".msg.assistant formatted-text");
    await Promise.all([user.updateComplete, assistant.updateComplete]);

    for (const formatted of [user, assistant]) {
      const code = formatted.shadowRoot?.querySelector("pre code");
      expect(code?.className).toBe("hljs language-sql");
      expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("SELECT");
    }
  });
});

function textMessage(role: ChatLine["role"], text: string): ChatLine {
  return { role, parts: [{ type: "text", text }] };
}

function formattedText(view: ChatView, selector: string): FormattedText {
  const formatted = view.shadowRoot?.querySelector<FormattedText>(selector);
  if (formatted === null || formatted === undefined) throw new Error(`Expected ${selector}`);
  return formatted;
}
