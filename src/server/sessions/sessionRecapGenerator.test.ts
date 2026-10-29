import { describe, expect, it } from "vitest";
import { buildRecapPrompt, excerptRecapText, generateSessionRecap, parseRecapOutput, recapExchanges, RECAP_PROMPT_MAX_BYTES } from "./sessionRecapGenerator.js";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";

const user = (content: string) => ({ role: "user", content });
const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const content = { summary: "Fixing the browser path. The fix is implemented but not deployed; validation has not run." };
describe("recap history and output", () => {
  it("uses visible text only and merges adjacent user messages", () => {
    expect(recapExchanges([user("<skill name=\"x\">secret</skill>Request<file>private</file>"), user("correction"),
      { role: "toolResult", content: "secret" }, { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "toolCall", name: "read" }] },
      assistant("Implemented, not deployed"), { role: "custom", content: "Not a reply" }])).toEqual([
      { user: "Request\n\ncorrection", assistant: "Implemented, not deployed", messageCount: 3 },
    ]);
  });
  it("keeps the last eight answered exchanges and a pending correction", () => {
    const messages = Array.from({ length: 12 }, (_, index) => [user(`request ${String(index)}`), assistant(`answer ${String(index)}`)]).flat();
    const input = buildRecapPrompt([...messages, user("pending correction")]);
    expect(input?.prompt).not.toContain("User: request 3\n");
    expect(input?.prompt).toContain("User: request 4\n");
    expect(input?.prompt).toContain("Pending user request: pending correction");
    expect(input?.messageCount).toBe(17);
  });
  it("drops oldest exchanges before excerpting, retains newest answer and pending request, bounds UTF-8 bytes", () => {
    const input = buildRecapPrompt([user("old"), assistant("x".repeat(40_000)), user("latest"),
      assistant(`HEAD${"😀".repeat(40_000)}TAIL`), user(`CORRECTION${"界".repeat(40_000)}END`)]);
    expect(Buffer.byteLength(input?.prompt ?? "")).toBeLessThanOrEqual(RECAP_PROMPT_MAX_BYTES);
    expect(input?.prompt).toContain("[Earlier exchanges omitted]");
    expect(input?.prompt).not.toContain("User: old");
    expect(input?.prompt).toContain("Assistant: HEAD");
    expect(input?.prompt).toContain("TAIL");
    expect(input?.prompt).toContain("Pending user request: CORRECTION");
    expect(input?.prompt).toContain("END");
    expect(input?.prompt).toContain("[... excerpted ...]");
    expect(input?.prompt).not.toContain("�");
  });
  it("handles tiny excerpt budgets without splitting unicode", () => {
    for (let size = 0; size < 50; size++) {
      const text = excerptRecapText("😀".repeat(30), size);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(size);
      expect(text).not.toContain("�");
    }
    expect(buildRecapPrompt([{ role: "toolResult", content: "no user" }])).toBeUndefined();
  });
  it("accepts fenced JSON and rejects malformed, excessive, or invented fields", () => {
    expect(parseRecapOutput(`\n\`\`\`json\n${JSON.stringify(content)}\n\`\`\``)).toEqual(content);
    for (const value of [{ summary: "a".repeat(361) }, { summary: " " }, { ...content, needs: "approval" },
      { goal: "Ship a fix", done: ["Implemented"], left: [], next: null }]) {
      expect(parseRecapOutput(JSON.stringify(value))).toBeUndefined();
    }
    expect(parseRecapOutput("not json")).toBeUndefined();
  });
  it("makes one normalized side request and returns its usage without running an agent", async () => {
    const provider = fauxProvider();
    provider.setResponses([fauxAssistantMessage(JSON.stringify(content))]);
    const models = createModels(); models.setProvider(provider.provider);
    const model = models.getModel("faux", "faux-1");
    if (model === undefined) throw new Error("Missing faux model");
    const input = buildRecapPrompt([user("do it"), assistant("done")]);
    if (input === undefined) throw new Error("Missing recap prompt");
    const result = await generateSessionRecap(models.stream.bind(models), model, input.prompt,
      new AbortController().signal, () => { throw new Error("generation should succeed"); });
    expect(result.content).toEqual(content);
    expect(result.usage?.totalTokens).toBeGreaterThanOrEqual(0);
    expect(provider.state.callCount).toBe(1);
  });
});
