// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertMessage, type TextMessage } from "../transcript";
import { Thread } from "./Thread";
import { SessionFrame } from "./SessionFrame";

let root: Root;
const reply: TextMessage = { id: "reply", role: "assistant", text: "Hello", status: { type: "complete", reason: "stop" } };
function Fixture({ messages = [], running = false, loading = false, disabled = false, onNew = async () => {}, onCancel = async () => {} }: {
  messages?: TextMessage[];
  running?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onNew?: (message: AppendMessage) => Promise<void>;
  onCancel?: () => Promise<void>;
}) {
  const runtime = useExternalStoreRuntime({ messages, convertMessage, onNew, onCancel,
    isRunning: running, isLoading: loading, isDisabled: disabled });
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="A long session title" status={running ? "Running" : "Connected"}><Thread /></SessionFrame>
  </AssistantRuntimeProvider>;
}
async function render(props: Parameters<typeof Fixture>[0] = {}) {
  await act(async () => root.render(<Fixture {...props} />));
}
function button(label: string) { return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Homepage-derived thread", () => {
  it("renders existing history with a user bubble and formatted assistant reply", async () => {
    await render({ messages: [
      { id: "user", role: "user", text: "Keep **this** literal" },
      { ...reply, text: "## Implementation\n\nUse **streaming** and `cwd`.\n\n- Load history\n- Send prompts\n\n```ts\nconst cwd = '/tmp';\n```\n\n| State | Meaning |\n| --- | --- |\n| Ready | Send |" },
    ] });
    expect(document.querySelector('.message-user .user-bubble')?.textContent).toBe("Keep **this** literal");
    expect(document.querySelector('.message-assistant h2')?.textContent).toBe("Implementation");
    expect(document.querySelector('.message-assistant strong')?.textContent).toBe("streaming");
    expect(document.querySelectorAll('.message-assistant li')).toHaveLength(2);
    expect(document.querySelector('.code-body code')?.textContent).toBe("const cwd = '/tmp';\n");
    expect(document.querySelector('.hljs-keyword')?.textContent).toBe("const");
    expect(document.querySelector('table th')?.textContent).toBe("State");
    expect(document.querySelector('.table-scroll')?.getAttribute('tabindex')).toBe("0");
    expect(button("Copy response")).not.toBeNull();
  });

  it("keeps unknown code languages readable and does not execute raw HTML", async () => {
    await render({ messages: [{ ...reply, text: "```unknown-language\n<script>window.compromised = true</script>\n```\n\n<script>window.compromised = true</script>" }] });
    expect(document.querySelector('.code-body code')?.textContent).toContain("<script>");
    expect(document.querySelector('script')).toBeNull();
  });

  it("renders Markdown images as links without loading remote media", async () => {
    await render({ messages: [{ ...reply, text: "![Diagram](https://example.test/diagram.png)" }] });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.markdown a')?.getAttribute('href')).toBe("https://example.test/diagram.png");
    expect(document.querySelector('.markdown a')?.textContent).toBe("Diagram");
  });

  it("copies a response and reports clipboard denial", async () => {
    await render({ messages: [reply] });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Denied"));
    await act(async () => button("Copy response").click());
    expect(writeText).toHaveBeenCalledWith("Hello");
    expect(document.querySelector('.message-actions .copy-status')?.textContent).toBe("Copied");
    await act(async () => button("Copy response").click());
    expect(document.querySelector('.message-actions .copy-status')?.textContent).toContain("Copy failed");
  });

  it("shows history loading without a false welcome screen", async () => {
    await render({ loading: true, disabled: true });
    expect(document.querySelector('[aria-label="Loading conversation"]')).not.toBeNull();
    expect(document.querySelector('.thread-welcome')).toBeNull();
    expect(document.querySelector('textarea')?.disabled).toBe(true);
  });

  it("greets an empty ready session and prevents an empty send", async () => {
    await render();
    expect(document.querySelector('.thread-welcome')?.textContent).toBe("How can I help you today?");
    expect(button("Send message").disabled).toBe(true);
    expect(button("Stop generating")).toBeNull();
  });

  it("sends the typed draft through the existing runtime", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>(async () => {});
    await render({ messages: [reply], onNew });
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Send message").disabled).toBe(false);
    await act(async () => button("Send message").click());
    expect(onNew).toHaveBeenCalledOnce();
    expect(onNew.mock.calls[0]?.[0].content).toEqual([{ type: "text", text: "hello" }]);
    expect(input.value).toBe("");
  });

  it("offers Stop during a run and forwards cancellation", async () => {
    const onCancel = vi.fn(async () => {});
    await render({ messages: [reply], running: true, onCancel });
    expect(button("Send message")).toBeNull();
    expect(button("Stop generating").disabled).toBe(false);
    await act(async () => button("Stop generating").click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("updates streamed Markdown in place and keeps the current draft", async () => {
    const messages: TextMessage[] = [{ ...reply, status: { type: "running" }, text: "## Par" }];
    await render({ messages, running: true });
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "next question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render({ messages: [{ ...reply, text: "## Partial reply\n\nNow complete." }] });
    expect(document.querySelectorAll('.message-assistant')).toHaveLength(1);
    expect(document.querySelector('.message-assistant h2')?.textContent).toBe("Partial reply");
    expect(document.querySelector('textarea')).toBe(input);
    expect(input.value).toBe("next question");
  });

  it("copies code and exposes a clipboard failure instead of a false success", async () => {
    await render({ messages: [{ ...reply, text: "```js\nconst answer = 42;\n```" }] });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => button("Copy code").click());
    expect(writeText).toHaveBeenCalledWith("const answer = 42;\n");
    expect(document.querySelector('.copy-status')?.textContent).toBe("Copied");
    await act(async () => button("Copy code").click());
    expect(document.querySelector('.copy-status')?.textContent).toContain("Copy failed");
  });
});
