// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolState, TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";
import { SessionFrame } from "./SessionFrame";
import type { ComposerInputElement } from "./ComposerEditor";
import { DIAGRAM_QUIET_MS } from "./Diagram";
import { FILE_CHECK_DELAY_MS, type FileLinks } from "./FileTree";

// Mermaid needs a real layout engine. The thread tests check our side: when
// we draw, what we pass, and what we show when Mermaid refuses.
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async (source: string) => { if (source.includes("(((")) throw new Error("Parse error"); return true; }),
  render: vi.fn(async (id: string, source: string) => ({ svg: `<svg id="${id}" viewBox="0 0 640 120"><text>drawn</text></svg>`, source })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

let root: Root;
const answer = (text: string, id = "reply"): TranscriptMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] });
const reply = answer("Hello");
const tool = (id: string, state: ToolState, name = "bash", args: unknown = { command: `echo ${id}` }) =>
  ({ type: "tool" as const, id, name, args, state });
function Fixture({ messages = [], running = false, loading = false, disabled = false, onNew = async () => {}, onCancel = async () => {}, fileLinks }: {
  messages?: TranscriptMessage[];
  fileLinks?: FileLinks;
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
    <SessionFrame name="A long session title" status={running ? "Running" : "Connected"}><Thread fileLinks={fileLinks} /></SessionFrame>
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
    expect([...document.querySelectorAll('img')].filter((node) => !node.closest('[data-composer-input]'))).toEqual([]);
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
    expect(document.querySelector<ComposerInputElement>('[data-composer-input]')?.disabled).toBe(true);
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
    const input = document.querySelector<ComposerInputElement>('[data-composer-input]')!;
    await act(async () => {
      input.value = "hello";
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
    const input = document.querySelector<ComposerInputElement>('[data-composer-input]')!;
    await act(async () => {
      input.value = "next question";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render({ messages: [answer("## Partial reply\n\nNow complete.")] });
    expect(document.querySelectorAll('.message-assistant')).toHaveLength(1);
    expect(document.querySelector('.message-assistant h2')?.textContent).toBe("Partial reply");
    expect(document.querySelector<ComposerInputElement>('[data-composer-input]')).toBe(input);
    expect(input.value).toBe("next question");
  });

  it("repairs unfinished Markdown only while streaming and keeps the composer mounted", async () => {
    await render({ messages: [answer("A **partial")], running: true });
    const input = document.querySelector<ComposerInputElement>('[data-composer-input]')!;
    expect(document.querySelector('.message-assistant strong')?.textContent).toBe("partial");
    expect(document.querySelector('.message-assistant [data-status]')?.getAttribute('data-status')).toBe("running");
    await render({ messages: [answer("A **partial reply** with `cwd")], running: true });
    expect(document.querySelector('.message-assistant strong')?.textContent).toBe("partial reply");
    expect(document.querySelector('.message-assistant code')?.textContent).toBe("cwd");
    expect(document.querySelector<ComposerInputElement>('[data-composer-input]')).toBe(input);
    await render({ messages: [answer("A **partial")] });
    expect(document.querySelector('.message-assistant strong')).toBeNull();
    expect(document.querySelector('.markdown')?.textContent).toBe("A **partial");
    expect(document.querySelector<ComposerInputElement>('[data-composer-input]')).toBe(input);
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
    expect([...document.querySelectorAll('img, iframe, script')].filter((node) => !node.closest('[data-composer-input]'))).toEqual([]);
  });

  it("retains the draft while recovery disables commands, then permits sending again", async () => {
    await render({ messages: [reply] });
    const input = document.querySelector<ComposerInputElement>('[data-composer-input]')!;
    await act(async () => {
      input.value = "unsent draft";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render({ messages: [answer("Hello")], disabled: true });
    expect(document.querySelector<ComposerInputElement>('[data-composer-input]')).toBe(input);
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
  const summaries = () => [...document.querySelectorAll(".message-assistant details.tool-call > summary .trace-text")].map((node) => node.textContent);
  const rows = () => [...document.querySelectorAll<HTMLElement>(".message-assistant .tally")];
  const toggleOf = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(":scope > button.tally-toggle")!;
  const marks = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".tally-mark")].map((mark) => mark.dataset["tone"]);
  async function openRow(row: HTMLElement) {
    await act(async () => toggleOf(row).click());
    return row.querySelector<HTMLElement>(":scope > .tally-panel")!;
  }
  async function open(summary: string) {
    const node = [...document.querySelectorAll<HTMLElement>(".message-assistant summary")].find((item) => item.querySelector(".trace-text")?.textContent === summary)!;
    const details = node.parentElement as HTMLDetailsElement;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    return details;
  }

  it("joins a run's messages into one reply: a step row for the calls, then the answer", async () => {
    await render({ messages: [
      { id: "q", role: "user", parts: [{ type: "text", text: "List files" }] },
      { id: "a1", role: "assistant", parts: [{ type: "thinking", text: "Use **ls**." }, tool("t1", { type: "done", output: "a.txt\nb.txt", isError: false })] },
      answer("Two files.", "a2"),
    ] });
    expect(document.querySelectorAll(".message-assistant")).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(marks(rows()[0]!)).toEqual(["plain"]);
    // No narration: a quiet line names the call, and the whole line opens the step.
    expect(rows()[0]!.querySelector(".tally-line")?.textContent).toBe("1 tool call: bash echo t1");
    expect(toggleOf(rows()[0]!).getAttribute("aria-expanded")).toBe("false");
    expect(summaries()).toEqual([]);
    expect(document.querySelector(".message-assistant .reasoning-text, .message-assistant details.chain-of-thought")).toBeNull();
    expect([...document.querySelectorAll(".message-assistant .message-text > .markdown")].at(-1)?.textContent).toBe("Two files.");
    const panel = await openRow(rows()[0]!);
    expect(toggleOf(rows()[0]!).getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelector(".tally-title")?.textContent).toBe("bash");
    expect(panel.querySelector(".tally-notes strong")?.textContent).toBe("ls");
    expect(summaries()).toEqual(["ran bash echo t1"]);
    const card = await open("ran bash echo t1");
    expect([...card.querySelectorAll("pre")].map((node) => node.textContent)).toEqual(["echo t1", "a.txt\nb.txt"]);
    expect(button("Copy response")).not.toBeNull();
  });

  it("keeps the narration as the row's text, with its calls as marks beside it", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [
      { type: "text", text: "Let me check **the router**." },
      tool("r1", { type: "done", output: "", isError: false }, "read", { path: "a.ts" }),
      tool("r2", { type: "done", output: "", isError: false }, "read", { path: "b.ts" }),
    ] }] });
    const row = rows()[0]!;
    expect(row.querySelector(".tally-body strong")?.textContent).toBe("the router");
    expect(row.querySelector(".tally-line")).toBeNull();
    expect(toggleOf(row).getAttribute("aria-label")).toBe("2 tool calls");
    expect(marks(row)).toEqual(["plain", "plain"]);
    const panel = await openRow(row);
    expect(panel.querySelector(".tally-title")?.textContent).toBe("read \u00d72");
    expect(summaries()).toEqual(["ran read a.ts", "ran read b.ts"]);
  });

  it("joins adjacent silent steps into one row, with one panel section per step", async () => {
    const ran = (id: string) => tool(id, { type: "done", output: "", isError: false });
    await render({ messages: [
      { id: "a1", role: "assistant", parts: [ran("x")] },
      { id: "a2", role: "assistant", parts: [{ type: "thinking", text: "Next **y**." }, ran("y"), ran("z")] },
      { id: "a3", role: "assistant", parts: [{ type: "text", text: "Now check it." }, ran("w")] },
      { id: "a4", role: "assistant", parts: [ran("v")] },
      answer("Done.", "a5"),
    ] });
    expect(rows().map((row) => row.querySelector(".tally-line")?.textContent ?? row.querySelector(".tally-body")?.textContent))
      .toEqual(["3 tool calls in 2 steps: bash \u00d73", "Now check it.", "1 tool call: bash echo v"]);
    expect(marks(rows()[0]!)).toEqual(["plain", "plain", "plain"]);
    const panel = await openRow(rows()[0]!);
    const sections = [...panel.querySelectorAll(".tally-section")];
    expect(sections).toHaveLength(2);
    expect(sections[1]?.querySelector(".tally-notes strong")?.textContent).toBe("y");
    expect(summaries()).toEqual(["ran bash echo x", "ran bash echo y", "ran bash echo z"]);
  });

  it("names the running call on a row of silent steps", async () => {
    await render({ messages: [
      { id: "a1", role: "assistant", parts: [tool("x", { type: "done", output: "", isError: false })] },
      { id: "a2", role: "assistant", parts: [tool("y", { type: "running", output: "" })] },
    ], running: true });
    expect(rows()[0]!.querySelector(".tally-line")?.textContent).toBe("2 tool calls in 2 steps: bash echo y +1");
  });

  it("marks failed and stopped calls, and opens a failure to its error", async () => {
    await render({ messages: [answer("x", "a0"), { id: "a1", role: "assistant", parts: [
      tool("bad", { type: "done", output: "permission denied", isError: true }, "read", { path: "/etc/shadow" }),
    ] }, { id: "a2", role: "user", parts: [{ type: "text", text: "next" }] },
    { id: "a3", role: "assistant", parts: [tool("stop", { type: "interrupted" })] }] });
    expect(rows().map(marks)).toEqual([["bad"], ["faint"]]);
    expect(rows().map((row) => row.querySelector(".tally-line")?.textContent))
      .toEqual(["1 tool call, 1 failed: read /etc/shadow", "1 tool call, 1 stopped: bash echo stop"]);
    expect(document.querySelector(".trace-pre")).toBeNull();
    await openRow(rows()[0]!);
    const failed = await open("failed read /etc/shadow");
    expect(failed.dataset["tone"]).toBe("error");
    expect(failed.querySelector("pre[data-tone=error]")?.textContent).toBe("permission denied");
    expect([...failed.querySelectorAll("h4")].map((node) => node.textContent)).toEqual(["Input", "Error"]);
    await openRow(rows()[1]!);
    const stopped = await open("stopped bash echo stop");
    expect(stopped.querySelector(".trace-empty")?.textContent).toBe("No result. The run ended before this tool finished.");
  });

  it("marks a failure retried only when the same call later succeeds", async () => {
    const failed = (id: string, command: string) => tool(id, { type: "done", output: "no", isError: true }, "bash", { command });
    const passed = (id: string, command: string) => tool(id, { type: "done", output: "ok", isError: false }, "bash", { command });
    await render({ messages: [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Run it." }, failed("f1", "go run ./probe"), failed("f2", "npm test")] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Again." }, passed("p1", "go run ./probe"), passed("p2", "npm run test")] },
    ] });
    expect(rows().map(marks)).toEqual([["warn", "bad"], ["plain", "plain"]]);
    expect(toggleOf(rows()[0]!).getAttribute("aria-label")).toBe("2 tool calls, 1 failed, 1 failed, then retried");
  });

  it("shows the running call on a live line and blinks its mark", async () => {
    const parts = [tool("r1", { type: "done", output: "", isError: false }, "read", { path: "a.ts" }),
      tool("b1", { type: "running", output: "compiling" }, "bash", { command: "npm test" }),
      tool("r2", { type: "pending" }, "read", { path: "b.ts" })];
    await render({ messages: [{ id: "a", role: "assistant", parts }], running: true });
    const line = rows()[0]!.querySelector<HTMLElement>(".tally-line")!;
    expect(line.textContent).toBe("3 tool calls: bash npm test +2");
    expect(line.hasAttribute("data-live")).toBe(true);
    expect(marks(rows()[0]!)).toEqual(["plain", "live", "live"]);
    await render({ messages: [{ id: "a", role: "assistant", parts: parts.map((part) => ({ ...part, state: { type: "done" as const, output: "", isError: false } })) }] });
    expect(rows()[0]!.querySelector(".tally-line")?.hasAttribute("data-live")).toBe(false);
    expect(marks(rows()[0]!)).toEqual(["plain", "plain", "plain"]);
  });

  it("keeps an open step and an open call open through streaming and authoritative reload", async () => {
    const parts = [{ type: "text" as const, text: "Run the tests." },
      tool("test", { type: "running", output: "first chunk" }, "bash", { command: "npm test" })];
    await render({ messages: [{ id: "a", role: "assistant", parts }], running: true });
    const row = rows()[0]!;
    await openRow(row);
    const card = await open("running bash npm test");
    await render({ messages: [{ id: "a", role: "assistant", parts: [parts[0]!,
      tool("test", { type: "running", output: "second chunk" }, "bash", { command: "npm test" })] }], running: true });
    expect(rows()[0]).toBe(row);
    expect(toggleOf(row).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("details.tool-call")).toBe(card);
    expect(card.querySelectorAll("pre")[1]?.textContent).toBe("second chunk");
    const settled = { id: "a", role: "assistant" as const, parts: [parts[0]!, tool("test", { type: "done", output: "passed", isError: false }, "bash", { command: "npm test" })] };
    await render({ messages: [settled, answer("Done.", "b")] });
    expect(rows()[0]).toBe(row);
    expect(card.open).toBe(true);
    expect(card.querySelectorAll("pre")[1]?.textContent).toBe("passed");
    await render({ messages: [settled, answer("Done.", "b")], disabled: true });
    expect(rows()[0]).toBe(row);
    expect(card.open).toBe(true);
  });

  it("keeps text written after a call outside the step and copies only text", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [
      { type: "thinking", text: "Inspect the request." },
      tool("bad", { type: "done", output: "denied", isError: true }),
      tool("stop", { type: "interrupted" }),
      { type: "text", text: "The command failed." },
    ] }] });
    expect(rows()).toHaveLength(1);
    expect(marks(rows()[0]!)).toEqual(["bad", "faint"]);
    expect(rows()[0]!.textContent).not.toContain("The command failed.");
    expect([...document.querySelectorAll(".message-assistant .message-text > .markdown")].at(-1)?.textContent).toBe("The command failed.");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await act(async () => button("Copy response").click());
    expect(writeText).toHaveBeenCalledWith("The command failed.");
  });

  it("keeps thinking without calls in its own fold, and makes no row for text alone", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [{ type: "thinking", text: "Weigh it." }, { type: "text", text: "Answer." }] }] });
    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".chain-of-thought > summary .trace-label")?.textContent).toBe("reasoning");
    await render({ messages: [reply] });
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("details.chain-of-thought")).toBeNull();
  });

  it("keeps a skill load beside the step instead of inside it", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [
      { type: "thinking", text: "Load guidance first." },
      tool("s1", { type: "done", output: "# Simple English", isError: false }, "read", { path: "/home/me/.agents/skills/simple-english/SKILL.md" }),
      tool("t1", { type: "done", output: "clean", isError: false }, "bash", { command: "git status" }),
      { type: "text", text: "Ready." },
    ] }] });
    expect(rows()).toHaveLength(1);
    expect(marks(rows()[0]!)).toEqual(["plain"]);
    expect(rows()[0]!.querySelector(".tally-line")?.textContent).toBe("1 tool call: bash git status");
    expect(document.querySelector(".message-assistant .message-text > details.skill-load > summary .trace-text")?.textContent)
      .toBe("loaded skill simple-english");
  });

  it("shows a working line between steps but not while a call runs", async () => {
    await render({ messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "go" }] }], running: true });
    expect(document.querySelector(".message-assistant .trace-line .trace-text")?.textContent).toBe("working");
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("b", { type: "running", output: "" })] }], running: true });
    expect(document.querySelector(".message-assistant div.trace-line")).toBeNull();
    await render({ messages: [{ id: "a", role: "assistant", parts: [tool("b", { type: "done", output: "", isError: false })] }], running: true });
    expect(document.querySelector(".message-assistant div.trace-line .trace-text")?.textContent).toBe("working");
  });

  it("thinks out loud as a fold while a message streams, then folds the thinking into its step", async () => {
    await render({ messages: [{ id: "a", role: "assistant", parts: [{ type: "thinking", text: "Plan." }] }], running: true });
    expect(document.querySelector(".chain-of-thought > summary .trace-label")?.textContent).toBe("thinking");
    await render({ messages: [{ id: "a", role: "assistant", parts: [{ type: "thinking", text: "Plan." }, tool("b", { type: "pending" })] }], running: true });
    expect(document.querySelector("details.chain-of-thought")).toBeNull();
    expect(rows()).toHaveLength(1);
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
    expect(document.querySelector(".message-assistant .tally .tally-line")?.textContent).toBe("1 tool call: read docs/SKILL-notes.md");
  });
});

describe("History summaries", () => {
  const summaryText = "## Goal\n\n- Ship the Studio spike\n\n" + "Long detail. ".repeat(400);
  it("shows a compaction as one closed divider line and opens its summary as Markdown on request", async () => {
    await render({ messages: [answer("Before", "a1"),
      { id: "s", role: "system", summary: "compaction", parts: [{ type: "text", text: summaryText }] }, answer("After", "a2")] });
    const row = document.querySelector<HTMLDetailsElement>(".message-summary details.history-summary")!;
    expect(row.querySelector("summary")?.textContent).toBe(">earlier messages compacted into a summary");
    expect(row.open).toBe(false);
    expect(document.body.textContent).not.toContain("Ship the Studio spike");
    expect(document.querySelector(".message-system")).toBeNull();
    await act(async () => { row.open = true; row.dispatchEvent(new Event("toggle")); });
    expect(row.querySelector(".history-summary-text h2")?.textContent).toBe("Goal");
    expect(row.querySelector('button[aria-label="Copy summary"]')).not.toBeNull();
  });
  it("names a branch summary apart from a compaction", async () => {
    await render({ messages: [{ id: "b", role: "system", summary: "branch", parts: [{ type: "text", text: "Tried sessions." }] }] });
    expect(document.querySelector(".message-summary")?.getAttribute("data-summary")).toBe("branch");
    expect(document.querySelector(".history-summary-label")?.textContent).toBe("summary of the branch left behind");
  });
});

describe("Rich blocks", () => {
  it("turns a GitHub alert quote into a labelled callout and leaves plain quotes as quotes", async () => {
    await render({ messages: [answer("> [!WARNING]\n> Restart **sessiond** after this.\n\n> Just a quote.")] });
    const callout = document.querySelector('.markdown .callout')!;
    expect(callout.getAttribute('data-callout')).toBe("warning");
    expect(callout.getAttribute('role')).toBe("note");
    expect(callout.querySelector('.callout-label')?.textContent).toBe("Warning");
    expect(callout.textContent).not.toContain("[!WARNING]");
    expect(callout.querySelector('strong')?.textContent).toBe("sessiond");
    expect(document.querySelector('.markdown blockquote')?.textContent?.trim()).toBe("Just a quote.");
  });

  it("does not let a reply mark its own quote as a callout through raw attributes", async () => {
    await render({ messages: [answer('<blockquote data-callout="caution">Fake</blockquote>\n\n> Real quote')] });
    expect(document.querySelector('.markdown .callout')).toBeNull();
  });

  it("shows a pending callout while its marker streams, then labels it", async () => {
    await render({ messages: [answer("> [!WAR")], running: true });
    expect(document.querySelector('.markdown .callout')?.getAttribute('data-callout')).toBe("pending");
    expect(document.querySelector('.markdown .callout-label')).toBeNull();
    expect(document.querySelector('.markdown')?.textContent).not.toContain("[!WAR");
    await render({ messages: [answer("> [!WARNING]\n> Back up first.")] });
    expect(document.querySelector('.markdown .callout-label')?.textContent).toBe("Warning");
  });

  it("renders a steps fence as an ordered list that grows while it streams", async () => {
    await render({ messages: [answer("```steps\n1. Stop the unit\n   Run `systemctl stop web`.\n2. Rebu")], running: true });
    expect(document.querySelectorAll('.rich-steps > li')).toHaveLength(2);
    expect(document.querySelector('.code-header')).toBeNull();
    await render({ messages: [answer("```steps\n1. Stop the unit\n   Run `systemctl stop web`.\n2. Rebuild\n3. Start it\n```")] });
    const steps = [...document.querySelectorAll('.rich-steps > li')];
    expect(steps.map((step) => step.querySelector('.rich-step-title')?.textContent)).toEqual(["Stop the unit", "Rebuild", "Start it"]);
    expect(steps[0]!.querySelector('.rich-step-detail code')?.textContent).toBe("systemctl stop web");
    expect(document.querySelector('.code-body')).toBeNull();
  });

  it("renders a compare fence as options with the pick and its strengths and costs", async () => {
    await render({ messages: [answer("```compare\n## Fences (recommended)\nOne block each.\n+ Streams well\n- Body needs a second parse\n## Directives\n+ Real Markdown\n```")] });
    const options = [...document.querySelectorAll('.rich-option')];
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute('data-recommended')).toBe("true");
    expect(options[0]!.querySelector('[role="heading"]')?.textContent).toBe("Fences");
    expect(options[0]!.querySelector('.rich-option-pick')?.textContent).toBe("Recommended");
    expect(options[0]!.querySelector('[data-point="pro"]')?.textContent).toBe("Strength: Streams well");
    expect(options[0]!.querySelector('[data-point="con"]')?.textContent).toBe("Cost: Body needs a second parse");
    expect(options[1]!.hasAttribute('data-recommended')).toBe(false);
    expect(document.querySelector<HTMLElement>('.rich-compare-options')?.style.getPropertyValue('--options')).toBe("2");
  });

  it("keeps the link policy inside rich blocks", async () => {
    await render({ messages: [answer("```steps\n1. Open [docs](https://example.test/docs) not [bad](javascript:alert%281%29)\n   ![remote](https://example.test/x.png)\n```")] });
    expect(document.querySelector('.rich-steps a[href="https://example.test/docs"]')).not.toBeNull();
    expect(document.querySelector('.rich-steps a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('.rich-steps img')).toBeNull();
  });
});

describe("Rich blocks, round two", () => {
  it("renders a status fence as a checklist with a count and labelled states", async () => {
    await render({ messages: [answer("```status\nRelease checks\n[x] Build\n[!] Visual\n    Clips the composer.\n[ ] Deploy\n```")] });
    expect(document.querySelector('.checklist-title')?.textContent).toBe("Release checks");
    expect(document.querySelector('.checklist-summary')?.textContent).toBe("1 of 3 done, 1 failed");
    expect([...document.querySelectorAll('.checklist-item')].map((item) => item.getAttribute('data-state'))).toEqual(["done", "failed", "todo"]);
    expect(document.querySelectorAll('.checklist-segment')).toHaveLength(3);
    expect(document.querySelector('.checklist-item[data-state="failed"] .checklist-icon')?.getAttribute('aria-label')).toBe("Failed");
    expect(document.querySelector('.checklist-detail')?.textContent).toBe("Clips the composer.");
    expect(document.querySelector('.code-header')).toBeNull();
  });

  it("renders a files fence as a marked tree with a summary", async () => {
    await render({ messages: [answer("```files\nsrc/server/\n  ~ app.ts # wires it\n  + guide.ts\n- old.md\n```")] });
    expect(document.querySelector('.path-tree-summary')?.textContent).toBe("1 added, 1 changed, 1 deleted");
    expect([...document.querySelectorAll('.path-tree-name')].map((name) => name.textContent)).toEqual(["src/server/", "app.ts", "guide.ts", "old.md"]);
    expect(document.querySelector('.path-tree-row[data-mark="deleted"] .path-tree-icon')?.getAttribute('aria-label')).toBe("deleted");
    expect(document.querySelector('.path-tree-note')?.textContent).toBe("wires it");
    // Without a way to open files, the tree is only a listing.
    expect(document.querySelector('.path-tree-open')).toBeNull();
  });

  it("links the files a files fence names that exist, and opens one by its full path", async () => {
    const open = vi.fn();
    const existing = vi.fn(async (paths: readonly string[]) => new Set(paths.filter((path) => path !== "src/server/gone.ts")));
    await render({ fileLinks: { existing, open }, messages: [answer("```files\nsrc/server/\n  ~ app.ts # wires it\n  ~ gone.ts\n- old.md\n```")] });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, FILE_CHECK_DELAY_MS + 50)); });
    const opens = [...document.querySelectorAll<HTMLButtonElement>('.path-tree-open')];
    expect(opens.map((link) => link.title)).toEqual(["src/server/app.ts"]);
    await act(async () => opens[0]!.click());
    expect(open).toHaveBeenCalledWith("src/server/app.ts");
  });

  it("renders a facts fence as a definition list with Markdown values", async () => {
    await render({ messages: [answer("```facts\nTests: 1017 passed\nSlowest: `policy.test.ts`\n```")] });
    expect([...document.querySelectorAll('.fact-list dt')].map((label) => label.textContent)).toEqual(["Tests", "Slowest"]);
    expect(document.querySelector('.fact-list dd code')?.textContent).toBe("policy.test.ts");
  });

  it("shows diagram source while it streams, then draws once the source is still", async () => {
    vi.useFakeTimers();
    try {
      await render({ messages: [answer("```diagram\nflowchart LR\n  A --> B")], running: true });
      expect(document.querySelector('.diagram-code')?.textContent).toContain("A --> B");
      await render({ messages: [answer("```diagram\nflowchart LR\n  A --> B --> C\n```")] });
      expect(mermaid.render).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(DIAGRAM_QUIET_MS + 10); });
      expect(mermaid.render).toHaveBeenCalledOnce();
      expect(mermaid.render.mock.calls[0]![1]).toBe("flowchart LR\n  A --> B --> C\n");
      expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", startOnLoad: false }));
      const canvas = document.querySelector<HTMLElement>('.diagram-canvas')!;
      expect(canvas.querySelector('svg text')?.textContent).toBe("drawn");
      expect(canvas.getAttribute('role')).toBe("img");
      expect(canvas.style.getPropertyValue('--diagram-width')).toBe("640px");
      expect(document.querySelector('.diagram-source-toggle')?.textContent).toBe("Source");
      expect(button("Copy diagram source")).not.toBeNull();
    } finally { vi.useRealTimers(); mermaid.render.mockClear(); }
  });

  it("keeps the source readable and says so when Mermaid cannot draw it", async () => {
    vi.useFakeTimers();
    try {
      await render({ messages: [answer("```mermaid\nflowchart LR\n  A --> (((\n```")] });
      await act(async () => { await vi.advanceTimersByTimeAsync(DIAGRAM_QUIET_MS + 10); });
      expect(document.querySelector('.diagram')?.getAttribute('data-drawing')).toBe("failed");
      expect(document.querySelector('.diagram-status')?.textContent).toContain("could not be drawn");
      expect(document.querySelector('.diagram-code')?.textContent).toContain("A --> (((");
      expect(mermaid.render).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe("Rich blocks, round three", () => {
  it("renders a claims fence with a text label per confidence and evidence under its claim", async () => {
    await render({ messages: [answer("```claims\nverified: built at 21:20\n  `git log -1`\ninferred: no session has it\nopinion: restart now\nunknown: child agents\n```")] });
    const items = [...document.querySelectorAll('.claim-list-item')];
    expect(items.map((item) => item.getAttribute('data-confidence'))).toEqual(["verified", "inferred", "opinion", "unknown"]);
    expect(items.map((item) => item.querySelector('.claim-list-badge')?.textContent)).toEqual(["Verified", "Inferred", "Opinion", "Unknown"]);
    expect(items[0]!.querySelector('.claim-list-detail code')?.textContent).toBe("git log -1");
    expect(document.querySelector('.code-header')).toBeNull();
  });

  it("renders a details fence closed and keeps it open while the reply grows", async () => {
    await render({ messages: [answer("```details\nAll options\n- `--dry-run` writes nothing.")], running: true });
    const details = document.querySelector<HTMLDetailsElement>('details.disclosure')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('.disclosure-title')?.textContent).toBe("All options");
    details.open = true;
    await render({ messages: [answer("```details\nAll options\n- `--dry-run` writes nothing.\n- `--backup` keeps a copy.\n```\n\nDone.")] });
    expect(document.querySelector('details.disclosure')).toBe(details);
    expect(details.open).toBe(true);
    expect(details.querySelectorAll('.disclosure-body li')).toHaveLength(2);
  });

  it("renders a commands fence with notes, per-command copy, and copy all", async () => {
    await render({ messages: [answer("```commands\n# Rebuild\nnpm run build\n# Restart\n$ systemctl --user restart web\n```")] });
    expect([...document.querySelectorAll('.command-list-note')].map((note) => note.textContent)).toEqual(["Rebuild", "Restart"]);
    expect([...document.querySelectorAll('.command-list-code')].map((code) => code.textContent)).toEqual(["npm run build", "systemctl --user restart web"]);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await act(async () => document.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy command"]')[1]!.click());
    expect(writeText).toHaveBeenLastCalledWith("systemctl --user restart web");
    await act(async () => button("Copy all commands").click());
    expect(writeText).toHaveBeenLastCalledWith("npm run build\nsystemctl --user restart web");
  });

  it("renders a bars fence on one scale from zero with every value as text", async () => {
    await render({ messages: [answer("```bars\nSlowest, seconds\nbuild: 28 s\nthread: 7 s\nnone: 0 s\n```")] });
    expect(document.querySelector('.bar-chart-title')?.textContent).toBe("Slowest, seconds");
    const bars = [...document.querySelectorAll<HTMLElement>('.bar-chart-bar')];
    expect(bars.map((bar) => bar.style.getPropertyValue('--bar-share'))).toEqual(["100%", "25%", "0%"]);
    expect(bars[2]!.hasAttribute('data-empty')).toBe(true);
    expect([...document.querySelectorAll('.bar-chart-value')].map((value) => value.textContent)).toEqual(["28 s", "7 s", "0 s"]);
  });
});

describe("Rich blocks, round four", () => {
  it("renders a correction with the earlier claim struck through, the correct one, and the cause", async () => {
    await render({ messages: [answer("```correction\nwas: 4,000 tokens per message\nnow: about 1,100 tokens per call\ncause: characters next to tokens\n```")] });
    const note = document.querySelector('.correction-panel')!;
    expect(note.getAttribute('role')).toBe("note");
    expect(note.querySelector('.correction-panel-title')?.textContent).toBe("Correction");
    expect(note.querySelector('del')?.textContent).toBe("4,000 tokens per message");
    expect([...note.querySelectorAll('dt')].map((label) => label.textContent)).toEqual(["Earlier", "Correct", "Cause"]);
  });

  it("renders asides with a worded severity", async () => {
    await render({ messages: [answer("```asides\nhigh: sessiond is stale\n  Started at 18:22.\nlow: a label\n```")] });
    expect([...document.querySelectorAll('.aside-list-pill')].map((pill) => pill.textContent)).toEqual(["High", "Low"]);
    expect(document.querySelector('.aside-list-detail')?.textContent).toBe("Started at 18:22.");
  });

  it("renders a timeline with each time beside its event", async () => {
    await render({ messages: [answer("```timeline\nTonight\n18:22 - sessiond started\n21:20 - guide landed\n```")] });
    expect(document.querySelector('.timeline-title')?.textContent).toBe("Tonight");
    expect([...document.querySelectorAll('.timeline-event')].map((event) => [event.querySelector('.timeline-when')?.textContent, event.querySelector('.timeline-what')?.textContent]))
      .toEqual([["18:22", "sessiond started"], ["21:20", "guide landed"]]);
  });

  it("moves a quote's source line into a caption and leaves other quotes alone", async () => {
    await render({ messages: [answer("> Check the thing itself.\n> — AGENTS.md:58\n\n> Plain quote - not a source")] });
    const figure = document.querySelector('.quote-figure')!;
    expect(figure.querySelector('blockquote')?.textContent?.trim()).toBe("Check the thing itself.");
    expect(figure.querySelector('figcaption')?.textContent).toBe("AGENTS.md:58");
    expect(document.querySelectorAll('.quote-figure')).toHaveLength(1);
    expect(document.querySelector('.markdown > div > blockquote, .markdown-content > blockquote')?.textContent?.trim()).toBe("Plain quote - not a source");
  });

  it("keeps a callout a callout even when its last line looks like a source", async () => {
    await render({ messages: [answer("> [!NOTE]\n> Read the guide.\n> — AGENTS.md")] });
    expect(document.querySelector('.callout')?.getAttribute('data-callout')).toBe("note");
    expect(document.querySelector('.quote-figure')).toBeNull();
  });
});
