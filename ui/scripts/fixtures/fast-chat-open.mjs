// Fixed seed: every open has the same content, timestamps and tool identities.
export const fixtureCwd = "/fixture/fast-chat-open";
export function fixtureMessages(turns) {
  return Array.from({ length: turns }, (_, index) => {
    const turn = index + 1;
    const timestamp = 1791972000000 + turn * 1000;
    const toolIds = Array.from({ length: 6 }, (_, slot) => `tool-${turn}-${slot}`);
    const text = `Turn ${turn}: inspect the session loading path.\n\n` +
      "```typescript\n" + Array.from({ length: 60 }, (_, line) => `export const value${line} = { turn: ${turn}, line: ${line}, label: \"deterministic fixture\" };`).join("\n") +
      "\n```\n\n```mermaid\ngraph LR\n  Picker --> Store\n  Store --> History\n  History --> Transcript\n```\n\n" +
      `Readable last turn ${turn}.`;
    return [
      { id: `user-${turn}`, role: "user", content: `Inspect turn ${turn}.`, timestamp },
      { id: `assistant-tools-${turn}`, role: "assistant", timestamp: timestamp + 1,
        content: toolIds.map(id => ({ type: "toolCall", id, name: "read", arguments: { path: "src/session.ts" } })), stopReason: "toolUse" },
      ...toolIds.map((id, slot) => ({ id: `result-${id}`, role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: `Output ${slot}: ${"file content\n".repeat(20)}` }], timestamp: timestamp + 2 + slot, isError: false })),
      { id: `assistant-${turn}`, role: "assistant", content: [{ type: "text", text }], timestamp: timestamp + 9, stopReason: "stop" },
    ];
  }).flat();
}
export const fixtures = [
  { id: "small", turns: 20 }, { id: "large", turns: 300 }, { id: "huge", turns: 1500 },
  { id: "streaming", turns: 20, streaming: true },
].map(fixture => ({ ...fixture, cwd: fixtureCwd, name: `Baseline ${fixture.id}`, messages: fixtureMessages(fixture.turns) }));
