// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolState, TranscriptMessage } from "../transcript";
import type { ShellRun } from "../shellRun";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";
import { SessionFrame } from "./SessionFrame";
import { highlightCode } from "./highlightCode";

// Counts highlighting while keeping the real highlighter.
vi.mock("./highlightCode", async (original) => {
  const real = await original<typeof import("./highlightCode")>();
  return { highlightCode: vi.fn(real.highlightCode) };
});

let root: Root;
const say = (id: string, role: "user" | "assistant", text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const tool = (id: string, state: ToolState): TranscriptMessage["parts"][number] => ({ type: "tool", id, name: "bash", args: { command: `echo ${id}` }, state });
const shell = (id: string, run: ShellRun): TranscriptMessage => ({ id, role: "shell", parts: [{ type: "shell", run }] });

function Fixture({ messages, running }: { messages: readonly TranscriptMessage[]; running: boolean }) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, running), isRunning: running, onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}><SessionFrame name="Finished messages"><Thread /></SessionFrame></AssistantRuntimeProvider>;
}
async function render(messages: readonly TranscriptMessage[], running = false) {
  await act(async () => root.render(<Fixture messages={messages} running={running} />));
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  vi.mocked(highlightCode).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// The history above a reply that streams. These objects keep their identity, as the store keeps them.
const question = say("q1", "user", "Show the loader.");
const finishedReply: TranscriptMessage = { id: "a1", role: "assistant", parts: [
  tool("t1", { type: "done", output: "loader.ts", isError: false }),
  { type: "text", text: "Here it is.\n\n```ts\nconst loader = 1;\n```" },
] };
const followUp = say("q2", "user", "And now?");
const streaming = (text: string) => say("a2", "assistant", text);

describe("Finished messages", () => {
  it("marks settled replies and user messages finished, and leaves the streaming reply live", async () => {
    await render([question, finishedReply, followUp, streaming("Working")], true);
    expect(row("q1").dataset.finished).toBe("true");
    expect(row("a1").dataset.finished).toBe("true");
    expect(row("q2").dataset.finished).toBe("true");
    expect(row("a2").dataset.finished).toBeUndefined();
    await render([question, finishedReply, followUp, streaming("Done.")]);
    expect(row("a2").dataset.finished).toBe("true");
  });

  it("marks a shell row finished only once its command ends", async () => {
    await render([shell("s1", { command: "ls", result: { type: "running", output: "a" } })], true);
    expect(row("s1").dataset.finished).toBeUndefined();
    await render([shell("s1", { command: "ls", result: { type: "done", output: "a", cancelled: false, truncated: false, exitCode: 0 } })]);
    expect(row("s1").dataset.finished).toBe("true");
  });

  it("streams into one reply without highlighting a finished reply's code again", async () => {
    await render([question, finishedReply, followUp, streaming("One")], true);
    const code = row("a1").querySelector(".code-body code");
    expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    const highlights = vi.mocked(highlightCode).mock.calls.length;
    expect(highlights).toBeGreaterThan(0);
    for (const text of ["One two", "One two three", "One two three four"]) await render([question, finishedReply, followUp, streaming(text)], true);
    expect(row("a2").textContent).toContain("One two three four");
    expect(vi.mocked(highlightCode).mock.calls.length).toBe(highlights);
    expect(row("a1").querySelector(".code-body code")).toBe(code);
  });

  it("keeps an open disclosure in a finished reply open while another reply streams", async () => {
    await render([question, finishedReply, followUp, streaming("One")], true);
    const disclosure = row("a1").querySelector<HTMLElement>(".tally-toggle, details summary")!;
    await act(async () => disclosure.click());
    const open = () => row("a1").querySelector('[aria-expanded="true"], details[open]');
    expect(open()).not.toBeNull();
    const opened = open();
    for (const text of ["One two", "One two three"]) await render([question, finishedReply, followUp, streaming(text)], true);
    expect(open()).toBe(opened);
  });

  it("shows a finished reply's new content when the store replaces it, rather than freezing it by id", async () => {
    const running: TranscriptMessage = { id: "a1", role: "assistant", parts: [tool("t1", { type: "running", output: "half" })] };
    const tones = () => [...row("a1").querySelectorAll<HTMLElement>(".tally-mark")].map((mark) => mark.dataset["tone"]);
    await render([question, running], true);
    expect(tones()).toEqual(["live"]);
    // An authoritative reload brings the same id with a completed result and new text.
    await render([question, { id: "a1", role: "assistant", parts: [tool("t1", { type: "done", output: "whole", isError: false }), { type: "text", text: "Reloaded answer." }] }]);
    expect(tones()).toEqual(["plain"]);
    expect(row("a1").textContent).toContain("Reloaded answer.");
  });
});
