import { useEffect, useState } from "react";
import type { SessionModel } from "../contracts";
import type { QueuedMessage } from "../queue";
import { SessionFrame } from "../ui/SessionFrame";
import { Thread } from "../ui/Thread";
import type { ModelBinding } from "../ui/ModelPicker";
import { FixtureRuntime } from "../ui/fixtures/runtime";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { DUPLICATE, FAILED, OPEN_GITHUB, suggestion } from "../backlog/suggestions/fixtures/suggestions";
import { answer } from "../backlog/suggestions/fixtures/serverLike";
import { hereMessage } from "../backlog/suggestions/suggestionsModel";
import { PROPOSAL, PROPOSAL_ENTRY } from "../workflows/fixtures/proposals";
import { heldProposals, heldSuggestion, proposalNoun, type HeldProposal } from "./proposalLedge";
import { ProposalLedge } from "./ProposalLedge";

export const name = "Proposals at the input";
export const note = "The agent's open proposals and Pi's queue in the ledge that grows out of the input bar, in a session: one, a folded stack, the open list, states, the queue, and folded away to the handle";

const MODELS: SessionModel[] = [{ provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5" }, { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" }];
const model: ModelBinding = { model: MODELS[0], thinkingLevel: "high", disabled: false, listModels: async () => MODELS,
  listThinkingLevels: async () => ["off", "low", "medium", "high"], onModel: async () => undefined, onThinkingLevel: async () => undefined };
/** A short exchange above the input bar. */
const EXCHANGE: readonly ThreadMessageLike[] = [
  { role: "user", content: "The tool row stays on running after the stream drops. Can you find why and fix it?" },
  { role: "assistant", content: "The row stuck because streamRelay.ts never sends tool.end when the provider closes the stream early. I close every open row on a lost stream now, and the new test covers it.\n\nThe same early close also cuts the reply itself short, with no error. That is a separate fix, so I suggested it instead of doing it here." },
];
const quiet = { pending: {}, problems: {}, last: {}, drafts: {} };
const at = (minute: number) => `2026-10-28T10:${String(minute).padStart(2, "0")}:00Z`;
const github = { provider: "github" as const, repo: "simonwjackson/forgerie", label: "agent-filed" };
const markdown = (slug: string) => ({ provider: "markdown" as const, path: `.forgerie/backlog/2026-10-28-${slug}.md` });

const RETRY = suggestion("sg-retry", { destination: github, createdAt: at(1),
  body: "A stream that closes early ends the reply with no error, so you read half an answer. Retry once from the last complete block." });
const DOCK = suggestion("sg-dock", { destination: markdown("dock-height"), createdAt: at(3), title: "Give the pinned dock a height budget when the Fold is on its side",
  body: "At 711 × 374 the dock and the bar leave four lines of thread." });
const MORE = [
  suggestion("sg-picker", { destination: github, createdAt: at(4), title: "Show the thinking level in the session picker" }),
  suggestion("sg-old-line", { destination: markdown("old-issue-line"), createdAt: at(5), title: "Drop OldIssueProposalLine after the next archive sweep" }),
  suggestion("sg-meter", { destination: github, createdAt: at(6), title: "Count a queued compaction in the context meter" }),
  suggestion("sg-steer", { destination: markdown("steer-tooltip"), createdAt: at(7), title: "Say what Steer does in its tooltip, not how" }),
  suggestion("sg-long", { destination: github, createdAt: at(8), title: "Handle ERR_HTTP2_PROTOCOL_ERROR_DURING_STREAM_RESET_AFTER_GOAWAY_FRAME_RECEIVED in streamRelay.ts" }),
  suggestion("sg-audit", { destination: markdown("audit-parts"), createdAt: at(9), title: "Audit every *.part.tsx for a narrow-tall state" }),
];
const WORKFLOW = { ...PROPOSAL, createdAt: Date.parse(at(2)) };
const held = (suggestions: Parameters<typeof heldProposals>[0]["suggestions"], workflow = false) => heldProposals({ suggestions, view: quiet,
  messages: workflow ? [{ workflowEntry: PROPOSAL_ENTRY }] : [], proposals: workflow ? [WORKFLOW] : [] });
const NEW = suggestion("sg-new", { destination: github, createdAt: at(30), title: "Name the ledge's handle in the session menu too" });

const STEER: QueuedMessage = { kind: "steer", text: "Also check the session store, it might clear the rows the same way." };
const FOLLOW: QueuedMessage = { kind: "followUp", text: "When that's done, run the Fold postures and send me the light and dark shots." };
const LONG: QueuedMessage = { kind: "followUp", text: "Then write the test for the resume path. It should cover a read that returns after the app comes back, a read that fails, and a read that is still running when the app goes to the background again, because that third case is the one that flashed on the Fold this morning and I want to be sure it stays fixed." };

const noop = () => undefined;
const actions = { onFile: noop, onFileAndAct: noop, onDismiss: noop, onShow: noop, onReview: noop, onDismissProposal: noop,
  onFileAll: noop, onFileAndActAll: noop, onFileAndActHere: noop };

/**
 * A session with `proposals` and `queue` at the input. `open` presses the stack's count once it mounts, `folded` the
 * bar's handle, and `arrive` adds a newer proposal after the fold, as the reader's presses and the agent would.
 */
function Scene({ proposals, queue = [], open = false, folded = false, arrive, busy = false }: {
  proposals: readonly HeldProposal[]; queue?: readonly QueuedMessage[]; open?: boolean; folded?: boolean; arrive?: HeldProposal | undefined;
  /** The agent is mid-run with nothing queued. */
  busy?: boolean;
}) {
  const [shown, setShown] = useState(proposals);
  useEffect(() => {
    // Each press only from the state it changes, so a second run of the effect does not undo it.
    if (open) document.querySelector<HTMLButtonElement>("button[aria-label^='Show all'][aria-expanded='false']")?.click();
    if (folded) document.querySelector<HTMLButtonElement>("button.fold-handle[aria-expanded='true']")?.click();
    if (arrive) setShown((current) => current.some((proposal) => proposal.key === arrive.key) ? current : [arrive, ...current]);
  }, [open, folded, arrive]);
  const running = busy || queue.length > 0;
  return <FixtureRuntime messages={EXCHANGE} running={running}>
    <SessionFrame name="Fix the stuck tool row after a lost stream">
      <Thread model={model} working={running ? { queue: true, steer: true } : undefined}
        queue={{ items: queue, disabled: false, onClear: noop }}
        ledge={{ count: shown.length, noun: proposalNoun(shown.length), keys: shown.map((proposal) => proposal.key),
          content: shown.length === 0 ? null : <ProposalLedge proposals={shown} actions={actions} here={running ? "after-run" : "now"}
            otherModel={{ listModels: async () => MODELS, launch: () => ({ model: MODELS[1], words: "Claude Haiku 4.5" }), onPick: noop }} /> }} />
    </SessionFrame>
  </FixtureRuntime>;
}

/** One backlog suggestion, for a GitHub issue: kind, title, one line about it, File, File and act, More. */
export default function OneSuggestion() {
  return <Scene proposals={held([RETRY])} />;
}
export function OneWorkflow() {
  return <Scene proposals={held([], true)} />;
}
export function ThreeFolded() {
  return <Scene proposals={held([RETRY, DOCK], true)} />;
}
export function ThreeOpen() {
  return <Scene proposals={held([RETRY, DOCK], true)} open />;
}
/** More than fit: the list scrolls inside its share of the window, with a fade. */
export function NineOpen() {
  return <Scene proposals={held([RETRY, DOCK, ...MORE], true)} open />;
}
/** Filing and starting in the live ink, a failure with its reason and Retry, and a title with no break points. */
export function FilingFailed() {
  const proposals = [heldSuggestion({ ...OPEN_GITHUB, id: "sg-filing", createdAt: at(9) }, { ...quiet, pending: { "sg-filing": "file-and-act" } }),
    heldSuggestion({ ...FAILED, createdAt: at(8) }, quiet), ...held([MORE[4]!])];
  return <Scene proposals={proposals} open />;
}
export function QueueOne() {
  return <Scene proposals={[]} queue={[FOLLOW]} />;
}
export function QueueThree() {
  return <Scene proposals={[]} queue={[STEER, FOLLOW, LONG]} />;
}
/** Three proposals, folded, over two queued messages: the queue sits nearest the bar. */
export function Both() {
  return <Scene proposals={held([RETRY, DOCK], true)} queue={[STEER, FOLLOW]} />;
}
export function BothOpen() {
  return <Scene proposals={held([RETRY, DOCK], true)} queue={[STEER, FOLLOW]} open />;
}
/** Folded away: the bar at its normal height, and the handle the only trace. */
export function FoldedAway() {
  return <Scene proposals={held([RETRY, DOCK], true)} queue={[STEER, FOLLOW]} folded />;
}
/** Folded away, then a new proposal arrived: a live dot on the handle, and the ledge stays folded. */
export function FoldedAwayNew() {
  return <Scene proposals={held([RETRY, DOCK], true)} folded arrive={heldSuggestion(NEW, quiet)} />;
}
/**
 * Presses each control in turn once it is in the page, as the reader would. The thread's scroll closes a window-level
 * menu, so the last press opens it again while the thread settles, for about two seconds.
 */
function usePresses(selectors: readonly string[]) {
  useEffect(() => {
    let frame = 0;
    let step = 0;
    let frames = 0;
    const press = () => {
      const last = step >= selectors.length;
      document.querySelector<HTMLButtonElement>(selectors[Math.min(step, selectors.length - 1)]!)?.click();
      if (!last && document.querySelector(selectors[step]!) === null) step += 1;
      if (++frames < 120) frame = requestAnimationFrame(press);
    };
    frame = requestAnimationFrame(press);
    return () => cancelAnimationFrame(frame);
  }, [selectors]);
}
const OPEN_LIST = "button[aria-label^='Show all'][aria-expanded='false']";
const ALL_MENU = ".ledge-stack-head .menu-button-trigger[aria-expanded='false']";
const ROW_MORE = ".ledge-row [aria-haspopup='menu'][aria-expanded='false']";
const SEE_ROW_MORE = [ROW_MORE];
const SEE_LIST = [OPEN_LIST];
const SEE_ALL = [OPEN_LIST, ALL_MENU];

/** One suggestion's More, open: File and act here, File and act on another model, Show in chat, and Dismiss; File too on a narrow ledge. */
export function MoreOpen() {
  usePresses(SEE_ROW_MORE);
  return <Scene proposals={held([RETRY])} />;
}
/** Two suggestions and a workflow, the list open, and its head's All menu open: one press for both suggestions. */
export function AllOpen() {
  usePresses(SEE_ALL);
  return <Scene proposals={held([RETRY, DOCK], true)} />;
}
/** The All menu while the agent is mid-run: File and act here says it waits for the run to end. */
export function AllWhileRunning() {
  usePresses(SEE_ALL);
  return <Scene proposals={held([RETRY, DOCK], true)} busy />;
}
/** Three ready, and three the All menu leaves out: a close match to review, a failure to retry, and one filing. Its heading says so. */
export function AllLeavesOut() {
  usePresses(SEE_ALL);
  const proposals = [
    ...held([RETRY, DOCK, MORE[0]!], true),
    heldSuggestion({ ...DUPLICATE, createdAt: at(10) }, quiet),
    heldSuggestion({ ...FAILED, createdAt: at(11) }, quiet),
    heldSuggestion({ ...OPEN_GITHUB, id: "sg-filing", title: "Name the ledge's handle in the session menu too", createdAt: at(12) }, { ...quiet, pending: { "sg-filing": "file" } }),
  ].sort((a, b) => b.at - a.at);
  return <Scene proposals={proposals} />;
}
/** Eight suggestions and a workflow: on a narrow ledge the menu's button shortens to "All 8". */
export function AllEight() {
  usePresses(SEE_ALL);
  return <Scene proposals={held([RETRY, DOCK, ...MORE], true)} />;
}
/** One ready suggestion beside a workflow: no All menu, because the row's own actions do the same. */
export function OneReady() {
  usePresses(SEE_LIST);
  return <Scene proposals={held([RETRY], true)} />;
}
const STARTING = { ...quiet, pending: { [RETRY.id]: "file-and-act" as const, [DOCK.id]: "file-and-act" as const } };
/** Right after File and act on all 2: each row says it is filing and starting, and leaves the ledge once it has. */
export function AllStarting() {
  usePresses(SEE_LIST);
  return <Scene proposals={[heldSuggestion(RETRY, STARTING), heldSuggestion(DOCK, STARTING), ...held([], true)].sort((a, b) => b.at - a.at)} />;
}
/** The message the two filed suggestions send, as File and act on all 2 here writes it. */
const HERE: QueuedMessage = { kind: "followUp", text: hereMessage([answer(RETRY, "file"), answer(DOCK, "file")]) ?? "" };
/** Right after File and act on all 2 here, mid-run: both are filed and leave the ledge, and the work waits in the queue. */
export function HereQueued() {
  return <Scene proposals={held([], true)} queue={[HERE]} />;
}
