import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createEndTurnToolDefinition } from "./endTurnTool.js";

function context(calls: string[]): ExtensionToolContext {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- only the read-only branch is used by this tool.
  return { sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", content: calls.map((id) => ({ type: "toolCall", id })) } }] } } as unknown as ExtensionToolContext;
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
  it("does not report a declaration if persistence fails", () => {
    const tool = createEndTurnToolDefinition({ declare: () => { throw new Error("disk full"); } });
    expect(() => tool.execute("end", { awaiting: "nothing" }, undefined, undefined, context(["end"]))).toThrow("disk full");
  });
});
