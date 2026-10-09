import type { ChildSummary, ChildTranscript } from "../childAgentsModel";

const AT = 1791500000000;

export const CHILDREN: ChildSummary[] = [
  { name: "api", conversationId: 15, agent: "worker", busy: true, createdAt: AT, questions: [] },
  { name: "ui", conversationId: 21, agent: "design-engineer", busy: true, createdAt: AT + 1000,
    questions: [{ questionId: "q:40", question: "Should the empty state show the last run, or stay blank?", askedAt: AT + 60_000 }] },
  { name: "review", conversationId: 33, agent: null, busy: false, createdAt: AT + 2000, questions: [] },
];

export const TRANSCRIPT: ChildTranscript = {
  busy: true,
  messages: [
    { role: "user", content: "Add an empty state to the run list. The API contract is in docs/runs.md." },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "docs/runs.md" } }] },
    { role: "toolResult", toolName: "read", content: [{ type: "text", text: "# Runs\nGET /api/runs returns { runs: Run[] }." }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "ask_human", arguments: { question: "Should the empty state show the last run, or stay blank?" } }] },
  ],
};

export const STREAMING: ChildTranscript = {
  ...TRANSCRIPT,
  messages: TRANSCRIPT.messages.slice(0, 3),
  partial: { role: "assistant", content: [{ type: "text", text: "The contract returns an empty list when nothing has run, so the view" }] },
};
