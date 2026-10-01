import { describe, expect, it } from "vitest";
import { parseEvent, type PiMessage, type SessionEvent } from "./contracts";
import { carryUnsavedShellRows, convertMessage, fromHistory, reduceEvent, seedTranscript, type Transcript, type TranscriptMessage } from "./transcript";
import { LIVE_OUTPUT_LIMIT, type ShellRun } from "./shellRun";

const record = (command: string, output: string, timestamp: number, extra: Partial<PiMessage> = {}): PiMessage =>
  ({ role: "bashExecution", command, output, exitCode: 0, cancelled: false, truncated: false, timestamp, excludeFromContext: false, ...extra });
const runs = (state: Transcript): ShellRun[] => state.messages.flatMap((message) =>
  message.parts.flatMap((part) => part.type === "shell" ? [part.run] : []));
const apply = (state: Transcript, ...events: SessionEvent[]) => events.reduce(reduceEvent, state);
const start = (command: string, seq?: number, excludeFromContext = false): SessionEvent =>
  ({ type: "shell.start", command, excludeFromContext, ...(seq === undefined ? {} : { seq }) });
const chunk = (text: string, seq?: number): SessionEvent => ({ type: "shell.chunk", chunk: text, ...(seq === undefined ? {} : { seq }) });
const end = (output: string, exitCode = 0, seq?: number): SessionEvent =>
  ({ type: "shell.end", output, exitCode, cancelled: false, truncated: false, ...(seq === undefined ? {} : { seq }) });

describe("saved shell executions", () => {
  it("keeps every result field of a saved record and orders it with the conversation", () => {
    const state = fromHistory([{ role: "user", content: "hi", timestamp: 1 },
      record("npm test", "1 failed\n", 2, { exitCode: 1, truncated: true, fullOutputPath: "/tmp/pi-bash.log", excludeFromContext: true })]);
    expect(state.messages.map((message) => message.role)).toEqual(["user", "shell"]);
    expect(state.messages[1]!.key).toBe("bashExecution:2");
    expect(runs(state)).toEqual([{ command: "npm test", excludeFromContext: true, result: {
      type: "done", output: "1 failed\n", exitCode: 1, cancelled: false, truncated: true, fullOutputPath: "/tmp/pi-bash.log" } }]);
  });
  it("converts a shell row to one assistant-ui system message that carries the run and copy text", () => {
    const [message] = fromHistory([record("echo hi", "hi\n", 5)]).messages;
    expect(convertMessage(message!)).toEqual({ id: message!.id, role: "system",
      content: [{ type: "text", text: "$ echo hi\nhi\n" }], metadata: { custom: { shell: runs(fromHistory([record("echo hi", "hi\n", 5)]))[0] } } });
  });
});

describe("live shell output", () => {
  it("accepts the server's shell events, including a missing exit code", () => {
    expect(parseEvent({ type: "shell.start", command: "ls", excludeFromContext: true, seq: 1 })).toMatchObject({ type: "shell.start" });
    expect(parseEvent({ type: "shell.chunk", chunk: "a\n", seq: 2 })).toMatchObject({ type: "shell.chunk" });
    expect(parseEvent({ type: "shell.end", output: "x", exitCode: null, cancelled: true, truncated: false, seq: 3 })).toMatchObject({ type: "shell.end" });
    expect(parseEvent({ type: "shell.end", output: "boom", isError: true })).toMatchObject({ type: "shell.end", isError: true });
  });
  it("streams chunks into one running row, then takes the server's final output", () => {
    let state = apply(fromHistory([]), start("for i in 1 2", undefined, true), chunk("1\n"), chunk("2\n"));
    expect(runs(state)).toEqual([{ command: "for i in 1 2", excludeFromContext: true, result: { type: "running", output: "1\n2\n" } }]);
    const id = state.messages[0]!.id;
    state = reduceEvent(state, { type: "shell.end", output: "1\n2\n", exitCode: 3, cancelled: false, truncated: true, fullOutputPath: "/tmp/full.log" });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.id).toBe(id);
    expect(runs(state)[0]!.result).toEqual({ type: "done", output: "1\n2\n", exitCode: 3, cancelled: false, truncated: true, fullOutputPath: "/tmp/full.log" });
  });
  it("keeps only the newest live output, like Pi's saved result, and names the cut", () => {
    const state = apply(fromHistory([]), start("yes"), chunk("a".repeat(LIVE_OUTPUT_LIMIT)), chunk("bc"));
    expect(runs(state)[0]!.result).toEqual({ type: "running", output: `${"a".repeat(LIVE_OUTPUT_LIMIT - 2)}bc`, clipped: true });
    const done = reduceEvent(state, end("tail\n"));
    expect(runs(done)[0]!.result).toMatchObject({ type: "done", output: "tail\n" });
  });
  it("reports a server failure without losing output that already arrived", () => {
    const state = apply(fromHistory([]), start("make"), chunk("partial\n"),
      { type: "shell.end", output: "spawn failed", isError: true });
    expect(runs(state)[0]!.result).toEqual({ type: "failed", output: "partial\n", error: "spawn failed" });
  });
  it("adds the row beside a streaming reply without taking over the reply", () => {
    let state = apply(fromHistory([]), { type: "agent.start" }, { type: "assistant.delta", text: "Work" });
    const liveId = state.liveId;
    state = apply(state, start("date"), { type: "assistant.delta", text: "ing" });
    expect(state.liveId).toBe(liveId);
    expect(state.messages.map((message) => message.role)).toEqual(["assistant", "shell"]);
    expect(state.messages[0]!.parts).toEqual([{ type: "text", text: "Working" }]);
    expect(state.isRunning).toBe(true);
  });
  it("shows output whose start it missed, with the command unknown", () => {
    const fromChunk = apply(fromHistory([]), chunk("late\n"));
    expect(runs(fromChunk)).toEqual([{ result: { type: "running", output: "late\n" } }]);
    const fromEnd = apply(fromHistory([]), end("done\n", 0));
    expect(runs(fromEnd)).toEqual([{ result: { type: "done", output: "done\n", exitCode: 0, cancelled: false, truncated: false } }]);
  });
  it("starts a new row for each command", () => {
    const state = apply(fromHistory([]), start("a"), end("A"), start("b"), chunk("B"));
    expect(runs(state).map((run) => [run.command, run.result.type])).toEqual([["a", "done"], ["b", "running"]]);
  });
  it("closes a row whose end was missed when the next command starts, because only one runs at a time", () => {
    const state = apply(fromHistory([]), start("a"), chunk("A"), start("b"));
    expect(runs(state).map((run) => run.result)).toEqual([{ type: "interrupted", output: "A" }, { type: "running", output: "" }]);
  });
});

describe("shell rows across a join", () => {
  const seed = (history: PiMessage[], buffered: SessionEvent[], seq: number, bashRunning = false) =>
    seedTranscript(history, null, seq, false, buffered, bashRunning);
  it("does not repeat a command whose saved record the history already returned", () => {
    const state = seed([record("ls", "a\n", 9)], [start("ls", 3), chunk("a\n", 4), end("a\n", 0, 5)], 6);
    expect(runs(state)).toHaveLength(1);
    expect(state.messages[0]!.key).toBe("bashExecution:9");
  });
  it("replays a finished command that the history read did not include", () => {
    const state = seed([record("ls", "a\n", 9)], [start("pwd", 3), chunk("/w\n", 4), end("/w\n", 0, 5)], 6);
    expect(runs(state).map((run) => run.command)).toEqual(["ls", "pwd"]);
  });
  it("matches saved records only at the end of the history", () => {
    const state = seed([record("ls", "a\n", 8), record("pwd", "/w\n", 9)], [start("ls", 3), end("a\n", 0, 4)], 6);
    expect(runs(state).map((run) => run.command)).toEqual(["ls", "pwd", "ls"]);
  });
  it("keeps live events after the watermark, including a command still running", () => {
    const state = seed([], [start("sleep 9", 7), chunk("tick\n", 8)], 6, true);
    expect(runs(state)).toEqual([{ command: "sleep 9", excludeFromContext: false, result: { type: "running", output: "tick\n" } }]);
  });
  it("shows a command that runs at join time before any of its events arrive", () => {
    let state = seed([], [], 6, true);
    expect(runs(state)).toEqual([{ result: { type: "running", output: "" } }]);
    state = apply(state, chunk("out\n", 7), end("all out\n", 0, 8));
    expect(runs(state)).toEqual([{ result: { type: "done", output: "all out\n", exitCode: 0, cancelled: false, truncated: false } }]);
  });
  it("closes a replayed row that cannot finish because no command is running", () => {
    const state = seed([], [start("ls", 3), chunk("a\n", 4)], 6, false);
    expect(runs(state)[0]!.result).toEqual({ type: "interrupted", output: "a\n" });
  });
  it("adds no running placeholder when the end of the reported command was buffered first", () => {
    // Socket and status read are separate connections: the end can arrive before the status response.
    const state = seed([], [end("done\n", 0, 8)], 6, true);
    expect(runs(state).map((run) => run.result.type)).toEqual(["done"]);
  });
  it("finishes an interrupted row when its end arrives after the status read", () => {
    const state = reduceEvent(seed([], [start("ls", 3)], 6, false), end("a\n", 0, 9));
    expect(runs(state)).toEqual([{ command: "ls", excludeFromContext: false, result: { type: "done", output: "a\n", exitCode: 0, cancelled: false, truncated: false } }]);
  });
  it("skips failed commands, which Pi never saves, when matching saved records", () => {
    const state = seed([record("ls", "a\n", 9)], [start("bad", 2), { type: "shell.end", output: "spawn failed", isError: true, seq: 3 },
      start("ls", 4), end("a\n", 0, 5)], 6);
    expect(runs(state).map((run) => [run.command, run.result.type])).toEqual([["ls", "done"], ["bad", "failed"]]);
  });
});

describe("unsaved shell rows across a reload", () => {
  const done = (output: string) => ({ type: "done" as const, output, exitCode: 0, cancelled: false, truncated: false });
  const live = (command: string, output: string, id: string): TranscriptMessage =>
    ({ id, role: "shell", parts: [{ type: "shell", run: { command, excludeFromContext: false, result: done(output) } }] });
  const keyed = (role: "user" | "assistant", text: string, timestamp: number): TranscriptMessage =>
    ({ id: `${role}-${timestamp}`, role, key: `${role}:${timestamp}`, parts: [{ type: "text", text }] });
  const transcript = (...messages: TranscriptMessage[]): Transcript => ({ messages, nextId: 40, isRunning: false });
  it("keeps a finished row whose record Pi has not saved yet, after the message it followed", () => {
    const previous = transcript(keyed("user", "go", 1), live("date", "now\n", "shell-7"), keyed("assistant", "ok", 2));
    const refreshed = transcript(keyed("user", "go", 1), keyed("assistant", "ok", 2), keyed("assistant", "more", 3));
    const carried = carryUnsavedShellRows(previous, refreshed);
    expect(carried.messages.map((message) => message.id)).toEqual(["user-1", "shell-7", "assistant-2", "assistant-3"]);
  });
  it("drops the row once the reload returns its saved record, or the join replayed it", () => {
    const previous = transcript(live("date", "now\n", "shell-7"), live("pwd", "/w\n", "shell-8"));
    const refreshed = transcript(...fromHistory([record("date", "now\n", 5)]).messages, live("pwd", "/w\n", "shell-41"));
    expect(carryUnsavedShellRows(previous, refreshed)).toEqual(refreshed);
  });
  it("does not carry rows still running or rows that came from history", () => {
    const running: TranscriptMessage = { id: "shell-9", role: "shell", parts: [{ type: "shell", run: { result: { type: "running", output: "" } } }] };
    const saved = { ...live("ls", "a\n", "history-1"), key: "bashExecution:4" };
    expect(carryUnsavedShellRows(transcript(saved, running), transcript())).toEqual(transcript());
  });
});
