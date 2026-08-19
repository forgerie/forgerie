import { describe, expect, it } from "vitest";
import type { ChatLine } from "./components/shared";
import { appendShellChunk, finalizeShellMessage, shellStartMessage } from "./shellMessages";

describe("shell messages", () => {
  it("starts commands with their context policy", () => {
    expect(text(shellStartMessage("npm test"))).toBe("$ npm test");
    expect(text(shellStartMessage("npm test", true))).toBe("excluded from context\n\n$ npm test");
  });

  it("appends the first output with a prompt separator", () => {
    const messages = [shellStartMessage("printf hello")];

    const result = appendShellChunk(messages, "hello");

    expect(text(result[0])).toBe("$ printf hello\n\nhello");
    expect(messages).toEqual([shellStartMessage("printf hello")]);
  });

  it("appends later chunks without adding another separator", () => {
    const first = appendShellChunk([shellStartMessage("printf hello")], "hel");

    const result = appendShellChunk(first, "lo");

    expect(text(result[0])).toBe("$ printf hello\n\nhello");
  });

  it("starts a new shell line when the last message cannot accept output", () => {
    const messages: ChatLine[] = [{ role: "user", parts: [{ type: "text", text: "question" }] }];

    const result = appendShellChunk(messages, "output");

    expect(result).toHaveLength(2);
    expect(text(result[1])).toBe("output");
  });

  it("adds completion details in their observable order", () => {
    const messages = appendShellChunk([shellStartMessage("run")], "partial output");

    const result = finalizeShellMessage(messages, {
      type: "shell.end",
      output: "failure detail",
      isError: true,
      exitCode: 7,
      cancelled: true,
      truncated: true,
      fullOutputPath: "/tmp/full.log",
    });

    expect(text(result[0])).toBe([
      "$ run",
      "",
      "partial output",
      "",
      "failure detail",
      "exit 7",
      "cancelled",
      "output truncated",
      "full output: /tmp/full.log",
    ].join("\n"));
  });

  it("states when a command completed without output", () => {
    const result = finalizeShellMessage([shellStartMessage("true")], {
      type: "shell.end",
      output: "",
      isError: false,
    });

    expect(text(result[0])).toBe("$ true\n\n(no output)");
  });

  it("uses a default failure note and leaves completed output unchanged when no note is needed", () => {
    const failed = finalizeShellMessage([shellStartMessage("false")], {
      type: "shell.end",
      isError: true,
    });
    const output = appendShellChunk([shellStartMessage("echo ok")], "ok");

    expect(text(failed[0])).toBe("$ false\n\n(no output)\nBash command failed");
    expect(finalizeShellMessage(output, { type: "shell.end", isError: false })).toBe(output);
  });

  it("leaves non-shell messages unchanged", () => {
    const messages: ChatLine[] = [{ role: "assistant", parts: [{ type: "text", text: "done" }] }];

    expect(finalizeShellMessage(messages, { type: "shell.end", isError: false })).toBe(messages);
  });
});

function text(message: ChatLine | undefined): string | undefined {
  const part = message?.parts[0];
  return part?.type === "text" ? part.text : undefined;
}
