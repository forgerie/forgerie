// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { keyboardShortcutContextForEvent } from "./keyboardContext";

afterEach(() => {
  document.body.replaceChildren();
});

describe("keyboardShortcutContextForEvent", () => {
  it("classifies normal application controls as workbench context", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(contextFromKeyDown(button)).toBe("workbench");
  });

  it("classifies native fields and generic editor textboxes as text-entry context", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    document.body.append(input, editor);

    expect(contextFromKeyDown(input)).toBe("text-entry");
    expect(contextFromKeyDown(editor)).toBe("text-entry");
  });

  it("honors an explicit composer owner across a shadow root", () => {
    const composer = document.createElement("composer-draft");
    composer.setAttribute("data-keyboard-shortcut-context", "composer");
    const shadow = composer.attachShadow({ mode: "open" });
    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    shadow.append(editor);
    document.body.append(composer);

    expect(contextFromKeyDown(editor)).toBe("composer");
  });

  it("gives terminal ownership priority over its helper textarea", () => {
    const terminal = document.createElement("terminal-panel");
    terminal.setAttribute("data-keyboard-shortcut-context", "terminal");
    const shadow = terminal.attachShadow({ mode: "open" });
    const helper = document.createElement("textarea");
    shadow.append(helper);
    document.body.append(terminal);

    expect(contextFromKeyDown(helper)).toBe("terminal");
  });
});

function contextFromKeyDown(target: HTMLElement): ReturnType<typeof keyboardShortcutContextForEvent> {
  let context: ReturnType<typeof keyboardShortcutContextForEvent> | undefined;
  const listener = (event: KeyboardEvent) => { context = keyboardShortcutContextForEvent(event); };
  window.addEventListener("keydown", listener, { capture: true, once: true });
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true, composed: true }));
  if (context === undefined) throw new Error("Expected keydown to reach the context classifier");
  return context;
}
