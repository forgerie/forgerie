// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolState, TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";
import { SessionFrame } from "./SessionFrame";

let root: Root;
const answer = (text: string, id = "reply"): TranscriptMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] });
const reply = answer("Hello");
const tool = (id: string, state: ToolState, name = "bash", args: unknown = { command: `echo ${id}` }) =>
  ({ type: "tool" as const, id, name, args, state });
function Fixture({ messages = [], running = false, loading = false, disabled = false, onNew = async () => {}, onCancel = async () => {} }: {
  messages?: TranscriptMessage[];
  running?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onNew?: (message: AppendMessage) => Promise<void>;
  onCancel?: () => Promise<void>;
}) {
  const threadMessages = useThreadMessages(messages, running);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew, onCancel,
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
      { id: "user", role: "user", parts: [{ type: "text", text: "Keep **this** literal" }] },
      answer("## Implementation\n\nUse **streaming** and `cwd`.\n\n- Load history\n- Send prompts\n\n```ts\nconst cwd = '/tmp';\n```\n\n| State | Meaning |\n| --- | --- |\n| Ready | Send |"),
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
    await render({ messages: [answer("```unknown-language\n<script>window.compromised = true</script>\n```\n\n<script>window.compromised = true</script>")] });
    expect(document.querySelector('.code-body code')?.textContent).toContain("<script>");
    expect(document.querySelector('script')).toBeNull();
  });

  it("renders Markdown images as links without loading remote media", async () => {
    await render({ messages: [answer("![Diagram](https://example.test/diagram.png)")] });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.markdown a')?.getAttribute('href')).toBe("https://example.test/diagram.png");
    expect(document.querySelector('.markdown a')?.textContent).toBe("Diagram");
  });

  it("preserves workspace-relative links instead of labeling them blocked", async () => {
    await render({ messages: [answer("Read [the source](src/sessionStore.ts) and [the section](#details).")] });
    const links = document.querySelectorAll<HTMLAnchorElement>('.markdown a');
    expect(links[0]?.href).toBe(new URL("src/sessionStore.ts", window.location.href).href);
    expect(links[1]?.getAttribute('href')).toBe("#details");
    expect(document.querySelector('.markdown')?.textContent).toBe("Read the source and the section.");
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
    const messages: TranscriptMessage[] = [answer("## Par")];
    await render({ messages, running: true });
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "next question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render({ messages: [answer("## Partial reply\n\nNow complete.")] });
    expect(document.querySelectorAll('.message-assistant')).toHaveLength(1);
    expect(document.querySelector('.message-assistant h2')?.textContent).toBe("Partial reply");
    expect(document.querySelector('textarea')).toBe(input);
    expect(input.value).toBe("next question");
  });

  it("repairs unfinished Markdown only while streaming and keeps the composer mounted", async () => {
    await render({ messages: [answer("A **partial")], running: true });
    const input = document.querySelector('textarea')!;
    expect(document.querySelector('.message-assistant strong')?.textContent).toBe("partial");
    expect(document.querySelector('.message-assistant [data-status]')?.getAttribute('data-status')).toBe("running");
    await render({ messages: [answer("A **partial reply** with `cwd")], running: true });
    expect(document.querySelector('.message-assistant strong')?.textContent).toBe("partial reply");
    expect(document.querySelector('.message-assistant code')?.textContent).toBe("cwd");
    expect(document.querySelector('textarea')).toBe(input);
    await render({ messages: [answer("A **partial")] });
    expect(document.querySelector('.message-assistant strong')).toBeNull();
    expect(document.querySelector('.markdown')?.textContent).toBe("A **partial");
    expect(document.querySelector('textarea')).toBe(input);
  });

  it("streams an unfinished code fence then highlights and copies its final source", async () => {
    await render({ messages: [answer("```ts\nconst count =")], running: true });
    const code = document.querySelector('.code-body code')!;
    expect(code.textContent).toContain("const count =");
    expect(code.querySelector('.hljs-keyword')).toBeNull();
    await render({ messages: [answer("```ts\nconst count = 1;\n```")] });
    expect(document.querySelectorAll('.code-header')).toHaveLength(1);
    expect(document.querySelector('.code-body code')?.textContent).toBe("const count = 1;\n");
    expect(document.querySelector('.hljs-keyword')?.textContent).toBe("const");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce(undefined);
    await act(async () => button("Copy code").click());
    expect(writeText).toHaveBeenCalledWith("const count = 1;\n");
  });

  it("does not make unfinished links or unsafe URLs actionable", async () => {
    await render({ messages: [answer("Read [the guide](https://example.test/unfinished")], running: true });
    expect(document.querySelector('.markdown a[href]')).toBeNull();
    await render({ messages: [answer("Read [the guide](https://example.test/complete)")] });
    expect(document.querySelector('.markdown a')?.getAttribute('href')).toBe("https://example.test/complete");
    await render({ messages: [answer("[Bad](javascript:alert%281%29)\n\n![Bad image](data:image/svg+xml;base64,PHN2Zy8+)\n\n<iframe src=\"https://example.test\"></iframe>")] });
    expect(document.querySelector('.markdown a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('.markdown a[href^="data:"]')).toBeNull();
    expect(document.querySelector('img, iframe, script')).toBeNull();
  });

  it("retains the draft while recovery disables commands, then permits sending again", async () => {
    await render({ messages: [reply] });
    const input = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "unsent draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render({ messages: [answer("Hello")], disabled: true });
    expect(document.querySelector('textarea')).toBe(input);
    expect(input.value).toBe("unsent draft");
    expect(button("Send message").disabled).toBe(true);
    await render({ messages: [answer("Hello")] });
    expect(input.value).toBe("unsent draft");
    expect(button("Send message").disabled).toBe(false);
    await render({ messages: [reply], running: true, disabled: true });
    expect(button("Stop generating").disabled).toBe(true);
  });

  it("copies code and exposes a clipboard failure instead of a false success", async () => {
    await render({ messages: [answer("```js\nconst answer = 42;\n```")] });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => button("Copy code").click());
    expect(writeText).toHaveBeenCalledWith("const answer = 42;\n");
    expect(document.querySelector('.copy-status')?.textContent).toBe("Copied");
    await act(async () => button("Copy code").click());
    expect(document.querySelector('.copy-status')?.textContent).toContain("Copy failed");
  });
});

describe("Tools and reasoning", () => {
  const summaries = () => [...document.querySelectorAll(".message-assistant details:not(.chain-of-thought) > summary .trace-text")].map((node) => node.textContent);
  async function open(summary: string) {
    const node = [...document.querySelectorAll<HTMLElement>(".message-assistant summary")].find((item) => item.querySelector(".trace-text")?.textContent === summary)!;
    const details = node.parentElement as HTMLDetailsElement;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    return details;
  }

  it("joins a run's messages into one reply with collapsed reasoning, a tool line, and the answer", async () => {
    await render({ messages: [
      { id: "q", role: "user", parts: [{ type: "text", text: "List files" }] },
      { id: "a1", role: "assistant", parts: [{ type: "thinking", text: "Use **ls**." }, tool("t1", { type: "done", output: "a.txt\nb.txt", isError: false })] },
      answer("Two files.", "a2"),
    ] });
    expect(document.querySelectorAll(".message-assistant")).toHaveLength(1);
    expect(summaries()).toEqual(["reasoning", "ran bash echo t1"]);
    expect([...document.querySelectorAll(".message-assistant .message-text > .markdown")].at(-1)?.textContent).toBe("Two files.");
    const reasoning = await open("reasoning");
    expect(reasoning.querySelector(".reasoning-text strong")?.textContent).toBe("ls");
    const card = await open("ran bash echo t1");
    expect([...card.querySelectorAll("pre")].map((node) => node.textContent)).toEqual(["echo t1", "a.txt\nb.txt"]);
    expect(button("Copy response")).not.toBeNull();
  });

  it("renders output only when a tool is opened, and shows failures and stopped calls", async () => {
    await render({ messages: [answer("x", "a0"), { id: "a1", role: "assistant", parts: [
      tool("bad", { type: "done", output: "permission denied", isError: true }, "read", { path: "/etc/shadow" }),
    ] }, { id: "a2", role: "user", parts: [{ type: "text", text: "next" }] },
    { id: "a3", role: "assistant", parts: [tool("stop", { type: "interrupted" })] }] });
    expect(summaries()).toEqual(["failed read /etc/shadow", "stopped bash echo stop"]);
    expect(document.querySelector(".trace-pre")).toBeNull();
    const failed = await open("failed read /etc/shadow");
    expect(failed.dataset["tone"]).toBe("error");
    expect(failed.querySelector("pre[data-tone=error]")?.textContent).toBe("permission denied");
    expect([...failed.querySelectorAll("h4")].map((node) => node.textContent)).toEqual(["Input", "Error"]);
    const stopped = await open("stopped bash echo stop");
    expect(stopped.querySelector(".trace-empty")?.textContent).toBe("No result. The run ended before this tool finished.");
  });

  it("groups adjacent tools and names the running one while the run continues", async () => {
    const parts = [tool("r1", { type: "done", output: "", isError: false }, "read", { path: "a.ts" }),
      tool("r2", { type: "done", output: "", isError: false }, "read", { path: "b.ts" }),
      tool("b1", { type: "running", output: "compiling" }, "bash", { command: "npm test" })];
    await render({ messages: [{ id: "a", role: "assistant", parts }], running: true });
    expect(summaries()[0]).toBe("running 3 tools: bash npm test");
    expect(document.querySelector(".tool-group .trace-text")?.hasAttribute("data-live")).toBe(true);
    const live = await open("running bash npm test");
    expect(live.querySelectorAll("pre")[1]?.textContent).toBe("compiling");
    await render({ messages: [{ id: "a", role: "assistant", parts: [...parts.slice(0, 2), tool("b1", { type: "done", output: "ok", isError: false }, "bash", { command: "npm test" })] }] });
    expect(summaries()[0]).toBe("ran 3 tools: read, bash");
    await render({ messages: [{ id: "a", role: "assistant", parts: [...parts.slice(0, 2), tool("b1", { type: "done", output: "no", isError: true }, "bash", { command: "npm test" })] }] });
    expect(summaries()[0]).toBe("ran 3 tools, 1 failed: read, bash");
    expect(document.querySelector<HTMLElement>(".tool-group")?.dataset["tone"]).toBe("error");
  });

  it("groups alternating reasoning and tools together without swallowing text or another turn", async () => {
    await render({ messages: [
      { id: "q", role: "user", parts: [{ type: "text", text: "Check the code" }] },
      { id: "a", role: "assistant", parts: [
        { type: "thinking", text: "First inspect the file." }, tool("read", { type: "done", output: "file", isError: false }),
        { type: "thinking", text: "Then verify the change." }, tool("test", { type: "done", output: "ok", isError: false }),
        { type: "text", text: "The check passed." },
        { type: "thinking", text: "One more check." }, tool("extra", { type: "interrupted" }),
      ] },
      { id: "q2", role: "user", parts: [{ type: "text", text: "Another question" }] },
      answer("A text-only answer.", "a2"),
    ] });
    const groups = [...document.querySelectorAll<HTMLDetailsElement>("details.chain-of-thought")];
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => !group.open)).toBe(true);
    expect(groups[0]?.querySelectorAll("details.reasoning")).toHaveLength(2);
    expect(groups[0]?.querySelectorAll("details.tool-call")).toHaveLength(2);
    expect(groups[1]?.querySelectorAll("details.tool-call")).toHaveLength(1);
    expect(groups.some((group) => group.textContent?.includes("The check passed."))).toBe(false);
    expect(groups.some((group) => group.textContent?.includes("A text-only answer."))).toBe(false);
    expect(groups[0]?.querySelector(":scope > summary .trace-text")?.textContent).toBe("reasoning 2 tools");
    expect(groups[1]?.querySelector(":scope > summary .trace-text")?.textContent).toBe("reasoning, 1 stopped 1 tool");
  });

  it("keeps failures visible on the collapsed outer group and leaves response copying text-only", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [
      { type: "thinking", text: "Inspect the request." },
      tool("bad", { type: "done", output: "denied", isError: true }),
      tool("stop", { type: "interrupted" }),
      { type: "text", text: "The command failed." },
    ] }] });
    const group = document.querySelector<HTMLDetailsElement>("details.chain-of-thought")!;
    expect(group.open).toBe(false);
    expect(group.dataset["tone"]).toBe("error");
    expect(group.querySelector(":scope > summary .trace-label")?.textContent).toBe("reasoning, 1 failed, 1 stopped");
    expect(document.querySelector(".trace-pre")).toBeNull();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await act(async () => button("Copy response").click());
    expect(writeText).toHaveBeenCalledWith("The command failed.");
  });

  it("keeps the outer and inner disclosures open through streaming and authoritative reload", async () => {
    const parts = [{ type: "thinking" as const, text: "Run the tests." },
      tool("test", { type: "running", output: "first chunk" }, "bash", { command: "npm test" })];
    await render({ messages: [{ id: "a", role: "assistant", parts }], running: true });
    const group = document.querySelector<HTMLDetailsElement>("details.chain-of-thought")!;
    expect(group.querySelector(":scope > summary .trace-text")?.textContent).toBe("thinking 1 tool: bash npm test");
    expect(group.querySelector(":scope > summary .trace-text")?.hasAttribute("data-live")).toBe(true);
    await act(async () => { group.open = true; group.dispatchEvent(new Event("toggle")); });
    const card = await open("running bash npm test");
    await render({ messages: [{ id: "a", role: "assistant", parts: [parts[0]!,
      tool("test", { type: "running", output: "second chunk" }, "bash", { command: "npm test" })] }], running: true });
    expect(document.querySelector("details.chain-of-thought")).toBe(group);
    expect(group.open).toBe(true);
    expect(document.querySelector("details.tool-call")).toBe(card);
    expect(card.open).toBe(true);
    expect(card.querySelectorAll("pre")[1]?.textContent).toBe("second chunk");
    await render({ messages: [{ id: "a", role: "assistant", parts: [parts[0]!,
      tool("test", { type: "done", output: "passed", isError: false }, "bash", { command: "npm test" }),
      { type: "text", text: "Done." }] }] });
    expect(group.open).toBe(true);
    expect(card.open).toBe(true);
    expect(group.querySelector(":scope > summary .trace-text")?.textContent).toBe("reasoning 1 tool");
    expect(group.querySelector(":scope > summary .trace-text")?.hasAttribute("data-live")).toBe(false);
    expect(card.querySelectorAll("pre")[1]?.textContent).toBe("passed");
    // Reload from equivalent authoritative data without changing persisted IDs.
    await render({ messages: [{ id: "a", role: "assistant", parts: [parts[0]!,
      tool("test", { type: "done", output: "passed", isError: false }, "bash", { command: "npm test" }),
      { type: "text", text: "Done." }] }], disabled: true });
    expect(document.querySelector("details.chain-of-thought")).toBe(group);
    expect(group.open).toBe(true);
    expect(card.open).toBe(true);
  });

  it("labels tools without reasoning as tool activity and does not create a group for text alone", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("only", { type: "pending" })] }], running: true });
    expect(document.querySelector(".chain-of-thought > summary .trace-label")?.textContent).toBe("running tools");
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("only", { type: "done", output: "ok", isError: false })] }] });
    expect(document.querySelector(".chain-of-thought > summary .trace-label")?.textContent).toBe("tool activity");
    await render({ messages: [reply] });
    expect(document.querySelector("details.chain-of-thought")).toBeNull();
  });

  it("keeps a skill load out of the activity group and counts only the other tools there", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [
      { type: "thinking", text: "Load guidance first." },
      tool("s1", { type: "done", output: "# Simple English", isError: false }, "read", { path: "/home/me/.agents/skills/simple-english/SKILL.md" }),
      tool("t1", { type: "done", output: "clean", isError: false }, "bash", { command: "git status" }),
      { type: "text", text: "Ready." },
    ] }] });
    const groups = [...document.querySelectorAll<HTMLDetailsElement>("details.chain-of-thought")];
    expect(groups.map((group) => group.querySelector(":scope > summary .trace-text")?.textContent)).toEqual(["reasoning", "tool activity 1 tool"]);
    expect(groups.some((group) => group.querySelector(".skill-load"))).toBe(false);
    expect(document.querySelector(".message-assistant .message-text > details.skill-load > summary .trace-text")?.textContent)
      .toBe("loaded skill simple-english");
  });

  it("shows a working line while a run has no text yet", async () => {
    await render({ messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "go" }] }], running: true });
    expect(document.querySelector(".message-assistant .trace-line .trace-text")?.textContent).toBe("working");
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("b", { type: "running", output: "" })] }], running: true });
    expect(document.querySelectorAll(".message-assistant details:not(.chain-of-thought) > summary .trace-text")).toHaveLength(1);
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("b", { type: "done", output: "", isError: false })] }], running: true });
    expect(summaries()).toEqual(["ran bash echo b"]);
    expect(document.querySelector(".message-assistant div.trace-line .trace-text")?.textContent).toBe("working");
  });
});

describe("Skill records", () => {
  const handoff = { name: "handoff", location: "/skills/handoff/SKILL.md", content: "References are relative to /skills/handoff.\n\n# Handoff\n\nCall the tool." };
  const skillRead = (id: string, name: string, state: ToolState) =>
    tool(id, state, "read", { path: `/home/me/.agents/skills/${name}/SKILL.md` });
  const loads = () => [...document.querySelectorAll(".message-assistant details.skill-load > summary .trace-text, .message-assistant details.skill-loads > summary .trace-text")]
    .map((node) => node.textContent);
  async function toggle(details: HTMLDetailsElement) {
    await act(async () => { details.open = !details.open; details.dispatchEvent(new Event("toggle")); });
  }

  it("shows a skill invocation as the typed command beside the user's argument, with the skill text on request", async () => {
    await render({ messages: [{ id: "u", role: "user", skill: handoff, parts: [{ type: "text", text: "Sending while working" }] }, reply] });
    const record = document.querySelector<HTMLDetailsElement>(".message-user details.skill-invocation")!;
    expect(record.querySelector("summary")?.textContent).toBe("/skill:handoff");
    expect(record.open).toBe(false);
    expect(record.querySelector("pre")).toBeNull();
    expect(document.querySelector(".message-user .user-bubble")?.textContent).toBe("Sending while working");
    expect(document.querySelector(".message-user .user-bubble")?.textContent).not.toContain("<skill");
    await toggle(record);
    expect(record.querySelector(".skill-location")?.textContent).toContain("/skills/handoff/SKILL.md");
    expect(record.querySelector("pre")?.textContent).toBe(handoff.content);
  });

  it("shows only the command when the invocation had no argument", async () => {
    await render({ messages: [{ id: "u", role: "user", skill: handoff, parts: [] }] });
    expect(document.querySelector(".message-user summary")?.textContent).toBe("/skill:handoff");
    expect(document.querySelector(".message-user .user-bubble")).toBeNull();
  });

  it("names a loaded skill and opens to its path and text", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [skillRead("s", "simple-english", { type: "done", output: "# Simple English\n\nShort sentences.", isError: false })] }] });
    expect(loads()).toEqual(["loaded skill simple-english"]);
    expect(document.querySelector("details.chain-of-thought")).toBeNull();
    const load = document.querySelector<HTMLDetailsElement>("details.skill-load")!;
    expect(load.querySelector(".trace-pre")).toBeNull();
    await toggle(load);
    expect([...load.querySelectorAll("h4")].map((node) => node.textContent)).toEqual(["Path", "Skill text"]);
    expect([...load.querySelectorAll("pre")].map((node) => node.textContent))
      .toEqual(["/home/me/.agents/skills/simple-english/SKILL.md", "# Simple English\n\nShort sentences."]);
  });

  it("collapses adjacent loads into one line that keeps every name and any failure visible", async () => {
    const parts = [skillRead("a", "simple-english", { type: "done", output: "a", isError: false }),
      skillRead("b", "unslop", { type: "running", output: "" })];
    await render({ messages: [{ id: "a", role: "assistant", parts }], running: true });
    expect(loads()[0]).toBe("loading 2 skills: simple-english, unslop");
    expect(document.querySelector(".skill-loads > summary .trace-text")?.hasAttribute("data-live")).toBe(true);
    await render({ messages: [{ id: "a", role: "assistant", parts: [parts[0]!,
      skillRead("b", "unslop", { type: "done", output: "ENOENT: no such file", isError: true })] }] });
    const group = document.querySelector<HTMLDetailsElement>("details.skill-loads")!;
    expect(group.querySelector(":scope > summary .trace-text")?.textContent).toBe("loaded 2 skills, 1 failed: simple-english, unslop");
    expect(group.dataset["tone"]).toBe("error");
    await toggle(group);
    const failed = [...group.querySelectorAll<HTMLDetailsElement>("details.skill-load")][1]!;
    expect(failed.querySelector("summary .trace-text")?.textContent).toBe("failed to load skill unslop");
    expect(failed.dataset["tone"]).toBe("error");
    await toggle(failed);
    expect(failed.querySelector("pre[data-tone=error]")?.textContent).toBe("ENOENT: no such file");
  });

  it("reports a load the run stopped instead of a finished one", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [skillRead("s", "relay", { type: "interrupted" })] }] });
    expect(loads()).toEqual(["stopped loading skill relay"]);
    const load = document.querySelector<HTMLDetailsElement>("details.skill-load")!;
    await toggle(load);
    expect(load.querySelector(".trace-empty")?.textContent).toBe("No result. The run ended before this tool finished.");
  });

  it("keeps an ordinary read of another file as a tool", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("r", { type: "done", output: "x", isError: false }, "read", { path: "docs/SKILL-notes.md" })] }] });
    expect(loads()).toEqual([]);
    expect(document.querySelector("details.chain-of-thought details.tool-call > summary .trace-text")?.textContent).toBe("ran read docs/SKILL-notes.md");
  });
});
