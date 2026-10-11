import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createEndTurnToolDefinition } from "./endTurnTool.js";

function context(calls: string[], before: unknown[] = [{ type: "text", text: "Here is the result." }], earlier: unknown[] = []): ExtensionToolContext {
  const content = [...before, ...calls.map((id) => ({ type: "toolCall", id }))];
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- only the read-only branch is used by this tool.
  return { sessionManager: { getBranch: () => [...earlier, { type: "message", message: { role: "assistant", content } }] } } as unknown as ExtensionToolContext;
}
describe("end_turn", () => {
  it.each(["nothing", "reply"] as const)("records %s and ends the run without another model call", async (awaiting) => {
    const declare = vi.fn();
    const tool = createEndTurnToolDefinition({ declare });
    const result = await tool.execute("end", { awaiting }, undefined, undefined, context(["end"]));
    expect(declare).toHaveBeenCalledWith(awaiting);
    expect(result.terminate).toBe(true);
    expect(tool.exposure).toBe("model-only");
  });
  it("rejects a mixed batch rather than recording a declaration that did not end the run", () => {
    const declare = vi.fn();
    const tool = createEndTurnToolDefinition({ declare });
    expect(() => tool.execute("end", { awaiting: "reply" }, undefined, undefined, context(["work", "end"]))).toThrow("alone");
    expect(declare).not.toHaveBeenCalled();
  });
  it.each([
    ["thinking only", [{ type: "thinking", thinking: "Tell the user it is not published yet." }]],
    ["blank text", [{ type: "text", text: "  \n" }]],
    ["nothing", []],
  ])("rejects a declaration whose message shows the user no text (%s) and records nothing", (_label, before) => {
    const declare = vi.fn();
    const tool = createEndTurnToolDefinition({ declare });
    expect(() => tool.execute("end", { awaiting: "reply" }, undefined, undefined, context(["end"], before))).toThrow("no text");
    expect(declare).not.toHaveBeenCalled();
  });
  const refusal = { type: "message", message: { role: "toolResult", toolName: "end_turn", isError: true, content: [{ type: "text", text: "The user sees no reply: this message has no text, and thinking is not shown. Write your reply as text, then call end_turn alone in the same message." }] } };

  it("stops a second silent ending without claiming completion", async () => {
    const declare = vi.fn();
    const tool = createEndTurnToolDefinition({ declare });
    const result = await tool.execute("retry", { awaiting: "nothing" }, undefined, undefined, context(["retry"], [], [refusal]));
    expect(result).toMatchObject({ isError: true, terminate: true });
    expect(result.content.map(part => part.type === "text" ? part.text : "").join("\n")).toContain("run stopped");
    expect(declare).not.toHaveBeenCalled();
  });

  it("does not give another retry just because response state was checkpointed", async () => {
    const tool = createEndTurnToolDefinition({ declare: vi.fn() });
    const checkpoint = { type: "custom", customType: "forgerie.session-response.v1", data: { version: 1, kind: "checkpoint" } };
    const result = await tool.execute("retry", { awaiting: "nothing" }, undefined, undefined, context(["retry"], [], [refusal, checkpoint]));
    expect(result).toMatchObject({ isError: true, terminate: true });
  });

  it("accepts a corrected reply after a refusal", async () => {
    const declare = vi.fn();
    const tool = createEndTurnToolDefinition({ declare });
    const result = await tool.execute("retry", { awaiting: "reply" }, undefined, undefined, context(["retry"], [{ type: "text", text: "Please choose." }], [refusal]));
    expect(result.terminate).toBe(true);
    expect(declare).toHaveBeenCalledWith("reply");
  });

  it.each([
    ["user input", { type: "message", message: { role: "user", content: "Continue" } }],
    ["new run", { type: "custom", customType: "forgerie.session-response.v1", data: { version: 1, kind: "started" } }],
    ["other work", { type: "message", message: { role: "toolResult", toolName: "read", isError: false } }],
    ["successful declaration", { type: "custom", customType: "forgerie.session-response.v1", data: { version: 1, kind: "declared", awaiting: "nothing" } }],
  ])("allows a corrective retry again after %s", (_label, boundary) => {
    const tool = createEndTurnToolDefinition({ declare: vi.fn() });
    expect(() => tool.execute("next", { awaiting: "nothing" }, undefined, undefined, context(["next"], [], [refusal, boundary]))).toThrow("no text");
  });

  it("does not terminate a mixed batch even after a silent refusal", () => {
    const tool = createEndTurnToolDefinition({ declare: vi.fn() });
    expect(() => tool.execute("end", { awaiting: "nothing" }, undefined, undefined, context(["work", "end"], [], [refusal]))).toThrow("alone");
  });

  it("does not report a declaration if persistence fails", () => {
    const tool = createEndTurnToolDefinition({ declare: () => { throw new Error("disk full"); } });
    expect(() => tool.execute("end", { awaiting: "nothing" }, undefined, undefined, context(["end"]))).toThrow("disk full");
  });
});
