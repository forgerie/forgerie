import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createEndTurnToolDefinition } from "./endTurnTool.js";

function context(calls: string[], before: unknown[] = [{ type: "text", text: "Here is the result." }]): ExtensionToolContext {
  const content = [...before, ...calls.map((id) => ({ type: "toolCall", id }))];
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- only the read-only branch is used by this tool.
  return { sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", content } }] } } as unknown as ExtensionToolContext;
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
  it("does not report a declaration if persistence fails", () => {
    const tool = createEndTurnToolDefinition({ declare: () => { throw new Error("disk full"); } });
    expect(() => tool.execute("end", { awaiting: "nothing" }, undefined, undefined, context(["end"]))).toThrow("disk full");
  });
});
