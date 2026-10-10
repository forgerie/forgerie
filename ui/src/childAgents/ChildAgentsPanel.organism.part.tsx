import { useState } from "react";
import { ChildAgentsPanel, type ChildAgentsActions } from "./ChildAgentsPanel";
import type { ChildSummary, ChildTranscript } from "./childAgentsModel";
import type { ChildDetail } from "./childWorkModel";
import type { WorktreeActionResult } from "../worktrees/worktreeApi";
import { CHILDREN, STREAMING, TRANSCRIPT } from "./fixtures/children";
import { FINISHED, RUNS, REVIEW, DISCARD, CLEANUP } from "./fixtures/childWork";

export const name = "Child agents panel";
export const note = "Production child controls with local state. The preview does not call Git or a server.";
export const composition = {
  default: [{ part: "src/ui/ActionFooter.molecule.part.tsx", state: "default" }],
  Discard: [{ part: "src/childAgents/ChildWorkPanel.organism.part.tsx", state: "Discard" }],
  Runs: [{ part: "src/childAgents/ChildWorkPanel.organism.part.tsx", state: "Runs" }],
  Cleanup: [{ part: "src/childAgents/ChildWorkPanel.organism.part.tsx", state: "Cleanup" }],
};

function Scenario({ initial = [...CHILDREN, FINISHED], open, initialDetail, initialOutcome, error }: {
  initial?: ChildSummary[]; open?: number; initialDetail?: ChildDetail; initialOutcome?: WorktreeActionResult; error?: string;
}) {
  const [children, setChildren] = useState(initial);
  const [openId, setOpenId] = useState(open);
  const [detail, setDetail] = useState<ChildDetail>(initialDetail ?? { kind: "none" });
  const [outcome, setOutcome] = useState(initialOutcome);
  const [closed, setClosed] = useState(false);
  const [failure, setFailure] = useState(error);
  const messagesFor = (id: number | undefined): ChildTranscript["messages"] => id === 21 ? TRANSCRIPT.messages
    : id === 15 ? STREAMING.messages : [{ role: "user", content: "Keep the child branch actions reachable and verify the lifecycle states." },
      { role: "assistant", content: "The branch actions stay in the footer. I committed the change and verified the tests. Review the branch before landing." }];
  const [messages, setMessages] = useState<ChildTranscript["messages"]>(() => messagesFor(open));
  const selected = children.find((item) => item.conversationId === openId);
  const change = (id: number, patch: Partial<ChildSummary>) => setChildren((items) => items.map((item) => item.conversationId === id ? { ...item, ...patch } : item));
  const finish = (state: "landed" | "discarded") => {
    if (selected?.worktree) change(selected.conversationId, { worktree: { ...selected.worktree, state, ahead: 0, dirty: false, cleanup: { kind: "done" } } });
    setDetail({ kind: "none" }); setOutcome(state === "landed" ? { kind: "landed", sha: "abc1234", cleanup: { kind: "done" } } : { kind: "discarded", cleanup: { kind: "done" } });
  };
  const actions: ChildAgentsActions = {
    onOpenChild: (id) => { setOpenId(id); setMessages(messagesFor(id)); setOutcome(undefined); }, onBack: () => setOpenId(undefined), onClose: () => setClosed(true),
    onSend: async (id, text) => { setMessages((items) => [...items, { role: "user", content: text }]); change(id, { busy: true }); },
    onStop: (id) => change(id, { busy: false, questions: [] }), onAnswer: async (_id, text) => { if (selected) change(selected.conversationId, { busy: true, questions: [] }); setMessages((items) => [...items, { role: "user", content: text }]); },
    onReview: () => setDetail(REVIEW), onLand: () => finish("landed"), onPreviewDiscard: () => setDetail(DISCARD), onDiscard: () => finish("discarded"),
    onContinue: async (_id, text) => { const next = { ...FINISHED, name: "builder-2", conversationId: 45, busy: true }; setChildren((items) => [...items, next]); setOpenId(45); setMessages([{ role: "user", content: text }]); setOutcome(undefined); },
    onRuns: () => setDetail({ kind: "runs", data: RUNS }), onCleanup: () => setDetail(CLEANUP), onBackDetail: () => setDetail({ kind: "none" }),
    onRetryDetail: () => setDetail(initialDetail ?? { kind: "runs", data: RUNS }),
    onDismissOutcome: () => setOutcome(undefined), onDismissError: () => setFailure(undefined),
  };
  if (closed) return <button onClick={() => setClosed(false)}>Open child agents</button>;
  return <ChildAgentsPanel children={children} openId={openId} transcript={selected ? { messages, busy: selected.busy, ...(selected.conversationId === 15 && selected.busy ? { partial: STREAMING.partial } : {}) } : undefined}
    detail={detail} outcome={outcome} error={failure} runs={children.length ? RUNS : { ...RUNS, records: [] }} actions={actions} />;
}
export default function List() { return <Scenario />; }
export function ChildAsking() { return <Scenario open={21} />; }
export function ChildStreaming() { return <Scenario open={15} />; }
export function ChildIdle() { return <Scenario open={33} />; }
export function Finished() { return <Scenario open={44} />; }
export function Dirty() { return <Scenario open={44} initial={[{ ...FINISHED, worktree: { ...FINISHED.worktree!, dirty: true } }]} />; }
export function Landed() { return <Scenario open={44} initial={[{ ...FINISHED, worktree: { ...FINISHED.worktree!, state: "landed", ahead: 0, cleanup: { kind: "done" } } }]} />; }
export function Discarded() { return <Scenario open={44} initial={[{ ...FINISHED, worktree: { ...FINISHED.worktree!, state: "discarded", ahead: 0, cleanup: { kind: "done" } } }]} />; }
export function Discard() { return <Scenario open={44} initialDetail={DISCARD} />; }
export function Changes() { return <Scenario open={44} initialDetail={REVIEW} />; }
export function Runs() { return <Scenario initialDetail={{ kind: "runs", data: RUNS }} />; }
export function Cleanup() { return <Scenario initialDetail={CLEANUP} />; }
export function Conflict() { return <Scenario open={44} initialOutcome={{ kind: "conflict", defaultBranch: "main", files: ["actions.ts"], prompt: "Resolve actions.ts and commit." }} />; }
export function Blocked() { return <Scenario open={44} initialOutcome={{ kind: "blocked", reason: "main-dirty", files: ["actions.ts"] }} />; }
export function Stale() { return <Scenario open={44} initialOutcome={{ kind: "stale-preview" }} />; }
export function Empty() { return <Scenario initial={[]} />; }
export function Failed() { return <Scenario error="Question q:40 is not open" />; }
