import { describe, expect, it } from "vitest";
import { TERMINAL_SOFT_KEYS, terminalSoftKeySequence, type TerminalModesSnapshot } from "./terminalKeys";

describe("terminalSoftKeySequence", () => {
  it("maps common control keys to terminal bytes", () => {
    expect(terminalSoftKeySequence("escape")).toBe("\x1b");
    expect(terminalSoftKeySequence("tab")).toBe("\t");
    expect(terminalSoftKeySequence("ctrl-c")).toBe("\x03");
    expect(terminalSoftKeySequence("ctrl-d")).toBe("\x04");
    expect(terminalSoftKeySequence("ctrl-z")).toBe("\x1a");
    expect(terminalSoftKeySequence("ctrl-l")).toBe("\x0c");
    expect(terminalSoftKeySequence("ctrl-r")).toBe("\x12");
    expect(terminalSoftKeySequence("ctrl-u")).toBe("\x15");
    expect(terminalSoftKeySequence("ctrl-w")).toBe("\x17");
  });

  it("maps navigation keys to xterm-compatible sequences", () => {
    expect(terminalSoftKeySequence("arrow-up")).toBe("\x1b[A");
    expect(terminalSoftKeySequence("arrow-down")).toBe("\x1b[B");
    expect(terminalSoftKeySequence("arrow-right")).toBe("\x1b[C");
    expect(terminalSoftKeySequence("arrow-left")).toBe("\x1b[D");
    expect(terminalSoftKeySequence("home")).toBe("\x1b[H");
    expect(terminalSoftKeySequence("end")).toBe("\x1b[F");
    expect(terminalSoftKeySequence("page-up")).toBe("\x1b[5~");
    expect(terminalSoftKeySequence("page-down")).toBe("\x1b[6~");
    expect(terminalSoftKeySequence("delete")).toBe("\x1b[3~");
    expect(terminalSoftKeySequence("backspace")).toBe("\x7f");
  });

  it("respects application cursor key mode", () => {
    const applicationCursorMode: TerminalModesSnapshot = { applicationCursorKeysMode: true };

    expect(terminalSoftKeySequence("arrow-up", applicationCursorMode)).toBe("\x1bOA");
    expect(terminalSoftKeySequence("arrow-down", applicationCursorMode)).toBe("\x1bOB");
    expect(terminalSoftKeySequence("arrow-right", applicationCursorMode)).toBe("\x1bOC");
    expect(terminalSoftKeySequence("arrow-left", applicationCursorMode)).toBe("\x1bOD");
    expect(terminalSoftKeySequence("home", applicationCursorMode)).toBe("\x1bOH");
    expect(terminalSoftKeySequence("end", applicationCursorMode)).toBe("\x1bOF");
  });

  it("labels escape-prefixed word movement as Alt keys", () => {
    expect(TERMINAL_SOFT_KEYS.filter((key) => key.id.startsWith("meta-")).map((key) => [key.label, key.ariaLabel])).toEqual([
      ["Alt+B", "Alt B"],
      ["Alt+F", "Alt F"],
    ]);
    expect(terminalSoftKeySequence("meta-backward-word")).toBe("\x1bb");
    expect(terminalSoftKeySequence("meta-forward-word")).toBe("\x1bf");
  });
});
