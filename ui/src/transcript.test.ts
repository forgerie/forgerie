import { describe, expect, it } from "vitest";
import { parseEvent, type PiMessage, type SessionEvent } from "./contracts";
import { convertMessage, fromHistory, messageText, reduceEvent, seedTranscript, type Transcript, type TranscriptPart } from "./transcript";

const user = (text: string, timestamp = 1): PiMessage => ({ role: "user", content: text, timestamp });
const assistant = (text: string, timestamp = 2): PiMessage => ({ role: "assistant", content: [{ type: "text", text }], timestamp });
const call = (id: string, name = "bash", args: unknown = { command: "ls" }) => ({ type: "toolCall", id, name, arguments: args });
const asking = (timestamp: number, ...content: unknown[]): PiMessage => ({ role: "assistant", content, timestamp, stopReason: "toolUse" });
const result = (id: string, text: string, isError = false, timestamp = 9): PiMessage =>
  ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }], isError, timestamp });
const texts = (state: Transcript) => state.messages.map(messageText);
const tools = (state: Transcript) => state.messages.flatMap((message) => message.parts)
  .filter((part): part is Extract<TranscriptPart, { type: "tool" }> => part.type === "tool");
const apply = (state: Transcript, ...events: SessionEvent[]) => events.reduce(reduceEvent, state);

describe("transcript history", () => {
  it("keeps image-only user messages and converts their persisted images into attachments", () => {
    const state = fromHistory([{ role: "user", timestamp: 1, content: [{ type: "image", mimeType: "image/png", data: "aGk=" }] }]);
    expect(state.messages).toHaveLength(1);
    expect(convertMessage(state.messages[0]!)).toMatchObject({ role: "user", attachments: [{
      type: "image", contentType: "image/png", content: [{ type: "image", image: "data:image/png;base64,aGk=" }],
    }] });
    const next = reduceEvent(state, { type: "message.end", message: { role: "user", timestamp: 1,
      content: [{ type: "image", mimeType: "image/png", data: "aGk=" }] } });
    expect(next.messages).toHaveLength(1);
  });
  it("keeps text, thinking, and tool calls in order and attaches each tool result to its call", () => {
    const state = fromHistory([user("hello"),
      asking(2, { type: "thinking", thinking: "look first" }, { type: "text", text: "Checking." }, call("a")),
      result("a", "file.txt"),
      { role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: 4 }]);
    expect(state.messages.map((message) => message.parts.map((part) => part.type))).toEqual([["text"], ["thinking", "text", "tool"], ["text"]]);
    expect(tools(state)).toEqual([{ type: "tool", id: "a", name: "bash", args: { command: "ls" }, state: { type: "done", output: "file.txt", isError: false } }]);
  });
  it("marks calls without a result as interrupted unless the current turn is still running", () => {
    const history = [user("one"), asking(2, call("old")), user("two", 3), asking(4, call("current"))];
    expect(tools(fromHistory(history)).map((part) => part.state.type)).toEqual(["interrupted", "interrupted"]);
    expect(tools(fromHistory(history, true)).map((part) => part.state.type)).toEqual(["interrupted", "pending"]);
  });
  it("keeps repeated prompts as separate history messages", () => {
    expect(fromHistory([user("hello", 1), user("hello", 2)]).messages).toHaveLength(2);
  });
  it("skips empty thinking and unknown parts", () => {
    const state = fromHistory([{ role: "assistant", content: [{ type: "thinking", thinking: " " }, { type: "unknown" }] }, { role: "custom", content: "x" }]);
    expect(state.messages).toEqual([]);
  });
});

describe("live transcript", () => {
  it("keeps a live image-only echo and its persisted replacement", () => {
    const content = [{ type: "image", mimeType: "image/png", data: "aGk=" }];
    const echoed = reduceEvent(fromHistory([]), { type: "message.append", message: { role: "user", content } });
    expect(echoed.messages).toHaveLength(1);
    expect(echoed.messages[0]!.attachments).toHaveLength(1);
    const completed = reduceEvent(echoed, { type: "message.end", message: { role: "user", content, timestamp: 1 } });
    expect(completed.messages).toHaveLength(1);
    expect(completed.messages[0]!.id).toBe(echoed.messages[0]!.id);
    expect(completed.messages[0]!.attachments).toHaveLength(1);
  });
  it("reconciles the timestamp-free echo with the completed user message", () => {
    let state = reduceEvent(fromHistory([]), { type: "message.append", message: { role: "user", content: "hello" } });
    const id = state.messages[0]?.id;
    state = reduceEvent(state, { type: "message.end", message: user("hello") });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id, key: "user:1", provisional: false });
  });
  it("streams chunks into one message, then replaces partial text with the final answer", () => {
    let state = apply(fromHistory([user("hello")]), { type: "agent.start" }, { type: "assistant.delta", text: "Hel" });
    const id = state.liveId;
    state = apply(state, { type: "assistant.delta", text: "lo" });
    expect(texts(state).at(-1)).toBe("Hello");
    state = apply(state, { type: "message.end", message: assistant("Hello!") }, { type: "message.end", message: assistant("Hello!") });
    expect(state.messages).toHaveLength(2);
    expect(state.messages.at(-1)).toMatchObject({ id, parts: [{ type: "text", text: "Hello!" }] });
    expect(state.liveId).toBeUndefined();
    expect(state.isRunning).toBe(true);
    expect(reduceEvent(state, { type: "agent.end" }).isRunning).toBe(false);
  });
  it("streams thinking and text as separate parts, then takes the final message", () => {
    const state = apply(fromHistory([]), { type: "assistant.thinking.delta", text: "Plan" },
      { type: "assistant.thinking.delta", text: " it" }, { type: "assistant.delta", text: "Answer" });
    expect(state.messages.at(-1)?.parts).toEqual([{ type: "thinking", text: "Plan it" }, { type: "text", text: "Answer" }]);
    const final = reduceEvent(state, { type: "message.end", message: { role: "assistant", timestamp: 2,
      content: [{ type: "thinking", thinking: "Plan it." }, { type: "text", text: "Answer." }] } });
    expect(final.messages).toHaveLength(1);
    expect(final.messages[0]?.parts).toEqual([{ type: "thinking", text: "Plan it." }, { type: "text", text: "Answer." }]);
  });
  it("does not use the previous answer as the next run's live message", () => {
    const state = apply(fromHistory([assistant("first answer")]), { type: "agent.start" }, { type: "assistant.delta", text: "new answer" });
    expect(texts(state)).toEqual(["first answer", "new answer"]);
  });
  it("preserves interrupted text and exposes provider errors", () => {
    let state = apply(fromHistory([]), { type: "assistant.delta", text: "partial" }, { type: "agent.end" });
    expect(state.messages.at(-1)).toMatchObject({ parts: [{ type: "text", text: "partial" }], failure: "cancelled" });
    state = reduceEvent(state, { type: "message.end", message: { ...assistant("", 5), stopReason: "error", errorMessage: "Provider unavailable" } });
    expect(state.error).toBe("Provider unavailable");
    expect(state.messages.at(-1)).toMatchObject({ parts: [{ type: "text", text: "Provider unavailable" }], failure: "error" });
  });
});

describe("tool executions", () => {
  it("advances the call from its message through start, update, and end as one execution", () => {
    let state = apply(fromHistory([user("run")], true), { type: "message.end", message: asking(2, { type: "text", text: "Running." }, call("a")) });
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "pending" }]);
    state = apply(state, { type: "tool.start", toolCallId: "a", toolName: "bash", args: { command: "ls" } },
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "fi" },
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "file" });
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "running", output: "file" }]);
    state = apply(state, { type: "tool.end", toolCallId: "a", toolName: "bash", text: "file.txt", isError: false },
      { type: "message.end", message: result("a", "file.txt\n") },
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "late" });
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "done", output: "file.txt\n", isError: false }]);
    expect(state.messages).toHaveLength(2);
  });
  it("keeps one execution when tool events arrive before the message that requested the call", () => {
    let state = apply(fromHistory([user("run")], true), { type: "assistant.delta", text: "Running." },
      { type: "tool.start", toolCallId: "a", toolName: "bash", args: { command: "ls" } });
    state = apply(state, { type: "message.end", message: asking(2, { type: "text", text: "Running." }, call("a")) },
      { type: "tool.end", toolCallId: "a", toolName: "bash", text: "boom", isError: true });
    expect(tools(state)).toHaveLength(1);
    expect(tools(state)[0]?.state).toEqual({ type: "done", output: "boom", isError: true });
    expect(texts(state)).toEqual(["run", "Running.", ""]);
  });
  it("keeps a result whose call is unknown as its own execution", () => {
    const state = reduceEvent(fromHistory([]), { type: "tool.end", toolCallId: "x", toolName: "read", text: "data", isError: false });
    expect(tools(state)).toEqual([{ type: "tool", id: "x", name: "read", args: undefined, state: { type: "done", output: "data", isError: false } }]);
  });
  it("interrupts open executions when the run ends", () => {
    const state = apply(fromHistory([user("run")], true), { type: "message.end", message: asking(2, call("a"), call("b")) },
      { type: "tool.start", toolCallId: "a", toolName: "bash", args: {} }, { type: "agent.end" });
    expect(tools(state).map((part) => part.state.type)).toEqual(["interrupted", "interrupted"]);
  });
});

describe("joining a running session", () => {
  it("joins a running stream once using the snapshot watermark", () => {
    const state = seedTranscript([user("hello")], assistant("Hel"), 3, true, [
      { type: "assistant.delta", text: "Hel", seq: 3 },
      { type: "assistant.delta", text: "lo", seq: 4 },
      { type: "message.end", message: assistant("Hello!"), seq: 5 },
      { type: "agent.end", seq: 6 },
    ]);
    expect(texts(state)).toEqual(["hello", "Hello!"]);
    expect(state.isRunning).toBe(false);
  });
  it("seeds tool calls and thinking from the partial and continues their executions", () => {
    const partial: PiMessage = { role: "assistant", timestamp: 2, content: [{ type: "thinking", thinking: "hm" }, call("a")] };
    const state = seedTranscript([user("hello")], partial, 3, true, [
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "out", seq: 4 },
      { type: "message.end", message: asking(2, { type: "thinking", thinking: "hm" }, call("a")), seq: 5 },
    ]);
    expect(state.messages.at(-1)?.parts.map((part) => part.type)).toEqual(["thinking", "tool"]);
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "running", output: "out" }]);
  });
  it("resumes tool progress covered by the watermark because the partial does not contain it", () => {
    const state = seedTranscript([user("hello"), asking(2, call("a"))], assistant("Next", 3), 5, true, [
      { type: "tool.start", toolCallId: "a", toolName: "bash", args: { command: "ls" }, seq: 3 },
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "progress", seq: 4 },
      { type: "assistant.delta", text: "Next", seq: 5 },
      { type: "assistant.delta", text: " answer", seq: 6 },
    ]);
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "running", output: "progress" }]);
    expect(texts(state)).toEqual(["hello", "", "Next answer"]);
  });
  it("keeps a tool result received between history and snapshot even when the run is already idle", () => {
    const state = seedTranscript([user("hello"), asking(2, call("a"))], null, 5, false, [
      { type: "tool.end", toolCallId: "a", toolName: "bash", text: "completed", isError: false, seq: 4 },
      { type: "agent.end", seq: 5 },
    ]);
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "done", output: "completed", isError: false }]);
    expect(state.isRunning).toBe(false);
  });
  it("does not replace an authoritative history result with earlier buffered tool output", () => {
    const state = seedTranscript([user("hello"), asking(2, call("a")), result("a", "persisted result")], null, 5, false, [
      { type: "tool.start", toolCallId: "a", toolName: "bash", args: {}, seq: 3 },
      { type: "tool.update", toolCallId: "a", toolName: "bash", text: "progress", seq: 4 },
      { type: "tool.end", toolCallId: "a", toolName: "bash", text: "event result", isError: false, seq: 5 },
    ]);
    expect(tools(state).map((part) => part.state)).toEqual([{ type: "done", output: "persisted result", isError: false }]);
  });
  it("avoids replaying a user echo whose final message already exists in history", () => {
    const state = seedTranscript([user("hello")], null, 5, false, [
      { type: "message.append", message: { role: "user", content: "hello" }, seq: 1 },
      { type: "message.end", message: user("hello"), seq: 2 },
    ]);
    expect(state.messages).toHaveLength(1);
  });
  it("keeps a completed earlier answer before a new join-time partial", () => {
    const state = seedTranscript([user("hello")], assistant("Next"), 5, true, [
      { type: "message.end", message: assistant("First", 2), seq: 2 },
      { type: "assistant.delta", text: "Next", seq: 5 },
      { type: "assistant.delta", text: " answer", seq: 6 },
    ]);
    expect(texts(state)).toEqual(["hello", "First", "Next answer"]);
  });
});

describe("assistant-ui conversion", () => {
  it("maps thinking to reasoning and each execution state to a tool-call result", () => {
    const state = fromHistory([user("go"), asking(2, { type: "thinking", thinking: "why" }, call("a"), call("b"), call("c")),
      result("a", "ok"), result("b", "bad", true)], true);
    const running = reduceEvent(state, { type: "tool.update", toolCallId: "c", toolName: "bash", text: "so far" });
    const converted = convertMessage(running.messages[1]!);
    expect(converted.content).toEqual([
      { type: "reasoning", text: "why" },
      { type: "tool-call", toolCallId: "a", toolName: "bash", args: { command: "ls" }, artifact: { state: "done" }, result: "ok", isError: false },
      { type: "tool-call", toolCallId: "b", toolName: "bash", args: { command: "ls" }, artifact: { state: "done" }, result: "bad", isError: true },
      { type: "tool-call", toolCallId: "c", toolName: "bash", args: { command: "ls" }, artifact: { state: "running" }, result: "so far", isPreliminary: true },
    ]);
    expect(converted.status).toBeUndefined();
    const stopped = convertMessage(reduceEvent(running, { type: "agent.end" }).messages[1]!);
    expect(stopped.content[3]).toMatchObject({ artifact: { state: "interrupted" }, result: "" });
  });
  it("marks only failed replies with an explicit status and passes non-object arguments as empty", () => {
    const failed = fromHistory([{ ...asking(2, call("a", "odd", "raw")), stopReason: "error", errorMessage: "Oops" }]);
    const converted = convertMessage(failed.messages[0]!);
    expect(converted.status).toEqual({ type: "incomplete", reason: "error" });
    expect(converted.content[0]).toMatchObject({ type: "tool-call", args: {} });
    expect(convertMessage({ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }).content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("event parsing", () => {
  it("ignores unrelated events and rejects malformed consumed events", () => {
    expect(parseEvent({ type: "shell.start", command: "ls" })).toBeUndefined();
    expect(() => parseEvent({ type: "assistant.delta", text: 5 })).toThrow();
    expect(() => parseEvent({ type: "tool.start", toolName: "bash" })).toThrow();
    expect(parseEvent({ type: "tool.end", toolCallId: "a", toolName: "bash", text: "", isError: false, seq: 3 })).toMatchObject({ seq: 3 });
  });
});

describe("images", () => {
  const png = { type: "image", mimeType: "image/png", data: "aGk=" };
  const pngUrl = "data:image/png;base64,aGk=";
  const imageResult = (id: string, ...content: unknown[]): PiMessage =>
    ({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "Read image file" }, ...content], timestamp: 9 });
  const doneImages = (state: Transcript) => tools(state).map((part) => part.state.type === "done" ? part.state.images : undefined);

  it("keeps tool images from history beside the textual output", () => {
    const state = fromHistory([user("look"), asking(2, call("a", "read", { path: "a.png" })),
      imageResult("a", png, { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" }, { type: "image", mimeType: "image/png" })]);
    expect(doneImages(state)).toEqual([[pngUrl]]);
    expect(tools(state)[0]!.state).toMatchObject({ output: "Read image file\n[image]\n[image]\n[image]" });
  });
  it("takes live tool images from the event's raw content", () => {
    let state = fromHistory([user("look"), asking(2, call("a", "read"))], true);
    state = apply(state, { type: "tool.end", toolCallId: "a", toolName: "read", text: "Read image file\n[image]", isError: false,
      content: [{ type: "text", text: "Read image file" }, png] });
    expect(doneImages(state)).toEqual([[pngUrl]]);
    // The persisted result that follows describes the same execution once.
    state = apply(state, { type: "message.end", message: imageResult("a", png) });
    expect(doneImages(state)).toEqual([[pngUrl]]);
  });
  it("carries no image list when a tool returned none", () => {
    const state = fromHistory([user("go"), asking(2, call("a")), result("a", "ok")]);
    expect(doneImages(state)).toEqual([undefined]);
    expect(convertMessage(state.messages[1]!).content[0]).toMatchObject({ artifact: { state: "done" } });
  });
  it("converts tool images onto the artifact and assistant images into image parts", () => {
    const state = fromHistory([user("draw"), asking(2, call("a", "read")), imageResult("a", png),
      { role: "assistant", content: [{ type: "text", text: "Here" }, png], timestamp: 10 }]);
    expect(convertMessage(state.messages[1]!).content[0]).toMatchObject({ artifact: { state: "done", images: [pngUrl] } });
    expect(convertMessage(state.messages[2]!).content).toEqual([{ type: "text", text: "Here" }, { type: "image", image: pngUrl }]);
  });
  it("keeps an image-only assistant reply instead of dropping it as empty", () => {
    const state = fromHistory([user("draw"), { role: "assistant", content: [png], timestamp: 2 }]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]!.parts).toEqual([{ type: "image", src: pngUrl }]);
  });
});
