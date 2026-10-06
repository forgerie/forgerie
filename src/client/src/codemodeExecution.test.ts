import { describe, expect, it } from "vitest";
import { codemodeCurrentCall, codemodeExecution, formatCodemodeCost, formatCodemodeDuration } from "./codemodeExecution";
import type { ToolExecutionPart } from "./components/shared";

// Shapes captured from a real Pi 1.0.4 codemode run (see the feature's probe).
const SCRIPT = "// List the project and read one file\nconst [ls, file] = await Promise.all([tools.bash({ command: 'ls -1' }), tools.read({ path: 'hello.txt' })]);\nreturn file;";

function codemodePart(patch: Partial<ToolExecutionPart> = {}): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call_1",
    toolName: "codemode",
    summary: "List the project and read one file",
    args: { code: SCRIPT },
    status: "success",
    ...patch,
  };
}

const completedContent = [
  { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
  { type: "text", text: "hello.txt\n" },
  { type: "text", text: "hello from a file\n" },
];

const completedDetails = {
  calls: [
    { id: "call_1/1", name: "bash", args: "{\"command\":\"ls -1\"}", status: "ok", durationMs: 14.74 },
    { id: "call_1/2", name: "read", args: "{\"path\":\"hello.txt\"}", status: "ok", durationMs: 8.21 },
  ],
};

describe("codemodeExecution", () => {
  it("reads the script, the calls, and the output without Pi's run header", () => {
    const view = codemodeExecution(codemodePart({ content: completedContent, details: completedDetails }));
    expect(view.script).toBe(SCRIPT);
    expect(view.wallTimeSeconds).toBe(0.1);
    expect(view.output).toBe("hello.txt\nhello from a file");
    expect(view.scriptError).toBeUndefined();
    expect(view.calls).toEqual([
      { key: "0", name: "bash", target: "ls -1", status: "ok", durationMs: 14.74 },
      { key: "1", name: "read", target: "hello.txt", status: "ok", durationMs: 8.21 },
    ]);
  });

  it("lifts a failure's script error out of the output and keeps each call's error", () => {
    const view = codemodeExecution(codemodePart({
      status: "error",
      content: [
        { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" },
        { type: "text", text: "before" },
        { type: "text", text: "[Image saved to /tmp/pi-codemode-1.png (image/png, 70B)]" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "Script error:\nError: ENOENT: missing.txt\n\nTool calls made before the failure (they are not undone): read (error)" },
      ],
      details: { calls: [{ id: "call_1/1", name: "read", args: "{\"path\":\"missing.txt\"}", status: "error", durationMs: 1.9, error: "ENOENT: missing.txt" }] },
    }));
    expect(view.output).toBe("before\n[Image saved to /tmp/pi-codemode-1.png (image/png, 70B)]");
    expect(view.scriptError).toBe("Error: ENOENT: missing.txt\n\nTool calls made before the failure (they are not undone): read (error)");
    expect(view.calls[0]).toMatchObject({ name: "read", status: "error", error: "ENOENT: missing.txt" });
  });

  it("keeps a result with no run header whole, such as a rejected script", () => {
    const view = codemodeExecution(codemodePart({ status: "error", content: [{ type: "text", text: "Tool codemode not found" }] }));
    expect(view.output).toBe("Tool codemode not found");
    expect(view.wallTimeSeconds).toBeUndefined();
  });

  it("names a call by its raw arguments when Pi cut the JSON short", () => {
    const view = codemodeExecution(codemodePart({ details: { calls: [{ name: "write", args: "{\"content\":\"a very long body that Pi cut...", status: "running" }] } }));
    expect(view.calls[0]?.target).toBe("{\"content\":\"a very long body that Pi cut...");
  });

  it("totals the cost of model calls and leaves it out when no call reported one", () => {
    const priced = codemodeExecution(codemodePart({ details: { calls: [
      { name: "models.classify", args: "{}", status: "ok", cost: 0.0004 },
      { name: "models.classify", args: "{}", status: "ok", cost: 0.0006 },
      { name: "bash", args: "{\"command\":\"ls\"}", status: "ok" },
    ] } }));
    expect(priced.modelCostUsd).toBeCloseTo(0.001);
    expect(priced.calls[0]?.target).toBe("");
    expect(codemodeExecution(codemodePart({ details: completedDetails })).modelCostUsd).toBeUndefined();
  });

  it("ignores call entries that do not carry a name and a known status", () => {
    const view = codemodeExecution(codemodePart({ details: { calls: [{ name: "bash", status: "exploded" }, { status: "ok" }, "junk"] } }));
    expect(view.calls).toEqual([]);
  });
});

describe("codemodeCurrentCall", () => {
  it("is the newest running call of a running script", () => {
    const running = codemodePart({
      status: "running",
      details: { calls: [
        { name: "bash", args: "{\"command\":\"npm test\"}", status: "running" },
        { name: "read", args: "{\"path\":\"a.ts\"}", status: "ok" },
        { name: "read", args: "{\"path\":\"b.ts\"}", status: "running" },
      ] },
    });
    expect(codemodeCurrentCall(running)).toMatchObject({ name: "read", target: "b.ts" });
  });

  it("is absent once the script settled or between calls", () => {
    expect(codemodeCurrentCall(codemodePart({ details: completedDetails }))).toBeUndefined();
    expect(codemodeCurrentCall(codemodePart({ status: "running", details: completedDetails }))).toBeUndefined();
  });
});

describe("codemode formatting", () => {
  it("shows durations and costs the way Pi's terminal does", () => {
    expect(formatCodemodeDuration(14.74)).toBe("15ms");
    expect(formatCodemodeDuration(2_340)).toBe("2.3s");
    expect(formatCodemodeCost(0.25)).toBe("$0.25");
    expect(formatCodemodeCost(0.00042)).toBe("$0.00042");
  });
});
