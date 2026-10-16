import { useState } from "react";
import { ActionFooter } from "../ui/ActionFooter";
import { ChildWorkPanel } from "./ChildWorkPanel";
import { childCost, landBlocker, money, resultText, totalCost, type ChildDetail, type Runs } from "./childWorkModel";
import type { WorktreeActionResult } from "../worktrees/worktreeApi";
import { SheetDialog } from "../ui/SheetDialog";
import { StatusRow } from "../ui/StatusRow";
import { ExchangeLog } from "../ui/ExchangeLog";
import { ReplyBox } from "../ui/ReplyBox";
import { NoticeBar } from "../ui/NoticeBar";
import { AlertCard } from "../ui/AlertCard";
import { useNow } from "../ui/useNow";
import { exchangeLines } from "./childExchange";
import { branchState, childStatus, childTone, middleCut, nextRetry, orderChildren, retryCount, retryLine, retryWait, unreadableWorktrees, type ChildSummary, type ChildTranscript } from "./childAgentsModel";

export interface ChildAgentsActions {
  onOpenChild: (conversationId: number) => void;
  onBack: () => void;
  onClose: () => void;
  onSend: (conversationId: number, text: string) => Promise<void>;
  onStop: (conversationId: number) => void;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onDismissError?: (() => void) | undefined;
  onReview: (conversationId: number) => void;
  onLand: (conversationId: number) => void;
  onPreviewDiscard: (conversationId: number) => void;
  onDiscard: (conversationId: number, token: string) => void;
  onContinue: (conversationId: number, text: string) => Promise<void>;
  onRuns: () => void;
  onCleanup: () => void;
  onBackDetail: () => void;
  onDismissOutcome: () => void;
  onRetryDetail: () => void;
}

/** A row is one glance: the provider's error is cut there, and read whole in the child's own view. */
const ROW_ERROR_LENGTH = 160;
/** Child branches can be 64 characters of hash. A row keeps both ends; its title keeps the whole name. */
const ROW_BRANCH_LENGTH = 28;

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;


/**
 * Shape: a session's child agents in one sheet. The list puts questions for
 * the reader first. An open child shows its record, with each question as a
 * card where it was asked, and one input: the answer to its oldest open
 * question while it has one, otherwise a message that steers it while it
 * works or gives it a new task when it is idle. Stop sits in the header while
 * it works. A child that waits to retry a model error counts down to the next
 * try in its row, and shows the whole error at the end of its record.
 */
export function ChildAgentsPanel({ children, openId, transcript, error, actions, detail = { kind: "none" }, outcome, pending, runs, drafts, now: clock = Date.now }: {
  children: readonly ChildSummary[];
  /** The child shown, or undefined for the list. */
  openId?: number | undefined;
  transcript?: ChildTranscript | undefined;
  error?: string | undefined;
  actions: ChildAgentsActions;
  detail?: ChildDetail | undefined;
  outcome?: WorktreeActionResult | undefined;
  pending?: string | undefined;
  runs?: Runs | undefined;
  drafts?: { values: Readonly<Record<string, string>>; update: (key: string, change: (text: string) => string) => void } | undefined;
  /** The clock a retry counts down on. */
  now?: () => number;
}) {
  const now = useNow(clock, nextRetry(children));
  const [localDrafts, setLocalDrafts] = useState<Record<string, string>>({});
  const draft = (key: string) => ({ value: (drafts?.values ?? localDrafts)[key] ?? "", update: (change: (text: string) => string) => {
    if (drafts) drafts.update(key, change);
    else setLocalDrafts((current) => ({ ...current, [key]: change(current[key] ?? "") }));
  } });
  const [writingId, setWritingId] = useState<number>();
  const [newTaskId, setNewTaskId] = useState<number>();
  const child = openId === undefined ? undefined : children.find((candidate) => candidate.conversationId === openId);
  const alert = error === undefined ? null : <NoticeBar tone="alert" message={error}
    actions={actions.onDismissError ? [{ label: "Dismiss", onPress: actions.onDismissError }] : []} />;
  const history = { label: runs ? `Runs ${totalCost(runs)}` : "Run history", onPress: actions.onRuns };
  if (detail.kind !== "none") return <ChildWorkPanel detail={detail} error={error} pending={pending}
    onClose={actions.onClose} onBack={actions.onBackDetail}
    onDiscard={(token) => { if (child) actions.onDiscard(child.conversationId, token); }}
    onRefresh={() => { if (detail.kind === "failed") actions.onRetryDetail(); else if (detail.kind === "runs") actions.onRuns(); else if (detail.kind === "cleanup") actions.onCleanup();
      else if (child && detail.kind === "discard") actions.onPreviewDiscard(child.conversationId); else if (child) actions.onReview(child.conversationId); else actions.onBackDetail(); }} />;
  if (!child) {
    const ordered = orderChildren(children);
    const asking = children.filter((candidate) => candidate.questions.length > 0).length;
    const working = children.filter((candidate) => candidate.busy && candidate.retry === undefined && candidate.questions.length === 0).length;
    const retrying = children.filter((candidate) => candidate.retry !== undefined).length;
    const ready = children.filter((item) => landBlocker(item) === undefined).length;
    // One failure that several children share is said once, above them, not as a grey status on every row.
    const unread = unreadableWorktrees(children);
    const shared = unread.length > 1;
    const counts = [asking > 0 ? `${String(asking)} ${asking === 1 ? "asks" : "ask"} you` : "", working > 0 ? `${String(working)} working` : "",
      retrying > 0 ? `${String(retrying)} retrying` : ""].filter(Boolean);
    const spent = runs && runs.records.length > 0 ? ` Spent ${totalCost(runs)} on ${plural(runs.records.length, "run", "runs")}.` : "";
    return <SheetDialog title="Child agents" closeLabel="Close child agents" onClose={actions.onClose}
      footer={<ActionFooter note={`${String(ready)} ready to land.${spent}`}
        actions={[{ label: "Run history", onPress: actions.onRuns }, { label: "Worktrees", onPress: actions.onCleanup }]} />}
      subtitle={children.length === 0 ? undefined : [`${String(children.length)} in this session`, ...counts].join(", ")}>
      {alert}
      {shared && <NoticeBar tone="alert" message={`Forgerie cannot read the worktrees of ${unread.length === children.length ? `all ${String(unread.length)}` : String(unread.length)} child agents, so it cannot say what is ready to land. ${unread[0]?.worktree?.statusError ?? ""}`}
        actions={[{ label: "Check worktrees", onPress: actions.onCleanup }]} />}
      {ordered.length === 0 ? <p>No child agents yet. When the agent starts one, it shows here, and you can open, steer, and stop it.</p>
        : ordered.map((item) => {
          const cost = childCost(runs, item.conversationId);
          const question = item.questions[0];
          const landable = landBlocker(item) === undefined;
          const open = () => actions.onOpenChild(item.conversationId);
          return <StatusRow key={item.conversationId} tone={childTone(item)} mark="block"
            name={item.name} detail={item.agent ?? undefined} meta={cost === undefined ? undefined : money(cost)}
            status={item.questions.length === 0 && item.retry ? retryWait(item.retry, now) : childStatus(item, { worktreeNotice: shared })} label={`Open ${item.name}`}
            onPress={open}
            below={question || item.retry || item.worktree ? <>{question && <p>{question.question}</p>}{item.questions.length === 0 && item.retry && <p>{retryLine(item.retry, ROW_ERROR_LENGTH)}</p>}
              {item.worktree && <p><code title={item.worktree.branch}>{middleCut(item.worktree.branch, ROW_BRANCH_LENGTH)}</code>, {branchState(item.worktree,
                shared && item.worktree.statusError !== undefined)}</p>}</> : undefined}
            actions={question ? [{ label: item.questions.length > 1 ? `Answer ${String(item.questions.length)} questions` : "Answer", tone: "primary", onPress: open }]
              : landable ? [{ label: "Review changes", onPress: () => { open(); actions.onReview(item.conversationId); }, disabled: pending !== undefined },
                { label: "Land", onPress: () => { open(); actions.onLand(item.conversationId); }, disabled: pending !== undefined }] : []} />;
        })}
    </SheetDialog>;
  }
  // A retry waits between model calls, so the child can read as idle; it is still at work, and Stop must reach it.
  const busy = (transcript?.busy ?? child.busy) || child.retry !== undefined;
  const question = child.questions[0];
  // One input. While the child waits on the reader, it answers the oldest open question, which the record shows as a card.
  const branch = child.worktree?.defaultBranch ?? "the default branch";
  const closed = child.worktree !== undefined && child.worktree.state !== "active";
  const blocker = landBlocker(child);
  const refusal = outcome?.kind === "conflict" ? "Resolve the conflict before landing again." : outcome?.kind === "blocked" ? "The last action was refused. See the details above." : undefined;
  const footer = closed ? newTaskId === child.conversationId
    ? <><p>A new child starts with the same agent settings and an empty conversation, in a fresh worktree from {branch}.</p>
      <ReplyBox key={`new-${String(child.conversationId)}`} draft={draft(`new:${child.conversationId}`)} label={`New task from ${branch}`} placeholder="Describe the new task" sendLabel="Start new child" autoFocus onSend={(text) => actions.onContinue(child.conversationId, text)} /></>
    : <ActionFooter note={`${child.worktree?.branch} is ${child.worktree?.state}. The old conversation is read-only.`}
      actions={[{ label: `Start new task from ${branch}`, onPress: () => setNewTaskId(child.conversationId), disabled: pending !== undefined },
        ...(child.worktree?.cleanup?.kind === "failed" ? [{ label: "Retry cleanup", onPress: () => {
          if (child.worktree?.state === "landed") actions.onLand(child.conversationId);
          else if (child.worktree?.cleanupRetryToken && outcome?.kind !== "stale-preview") actions.onDiscard(child.conversationId, child.worktree.cleanupRetryToken);
          else actions.onPreviewDiscard(child.conversationId);
        }, disabled: pending !== undefined }] : [])]} />
    : child.worktree && !busy && question === undefined && writingId !== child.conversationId
      ? <ActionFooter note={<><code>{child.worktree.branch}</code> · {child.worktree.ahead} commits ahead. {pending ? "Applying action…" : blocker ?? refusal ?? `Ready to land on ${branch}.`}</>}
        actions={[{ label: "Review changes", onPress: () => actions.onReview(child.conversationId), disabled: pending !== undefined },
          { label: "Land", tone: "primary", onPress: () => actions.onLand(child.conversationId), disabled: pending !== undefined || blocker !== undefined },
          { label: "Discard", tone: "danger", onPress: () => actions.onPreviewDiscard(child.conversationId), disabled: pending !== undefined },
          { label: "Continue working", onPress: () => setWritingId(child.conversationId), disabled: pending !== undefined }]} />
    : question !== undefined
    ? <ReplyBox key={question.questionId} draft={draft(question.questionId)} label={`Answer ${child.name}: ${question.question}`} sendLabel="Send answer" autoFocus
      placeholder={child.questions.length > 1 ? `Answer ${child.name}'s first question (1 of ${String(child.questions.length)})` : `Answer ${child.name}`}
      onSend={(answer) => actions.onAnswer(question.questionId, answer)} />
    : <ReplyBox key={`message-${String(child.conversationId)}`} draft={draft(`message:${child.conversationId}`)} label={`Message ${child.name}`} sendLabel={`Send to ${child.name}`}
      placeholder={busy ? `Steer ${child.name} while it works` : `Give ${child.name} another task`}
      onSend={(text) => actions.onSend(child.conversationId, text)} />;
  return <SheetDialog title={child.name} subtitle={[child.agent, refusal ? "Needs attention" : childStatus(child)].filter(Boolean).join(", ")}
    closeLabel="Close child agents" onClose={actions.onClose} back={{ label: "All child agents", onPress: actions.onBack }}
    actions={[history, ...(busy || question !== undefined ? [{ label: "Stop", onPress: () => actions.onStop(child.conversationId) }]
      : writingId === child.conversationId && !closed ? [{ label: "Branch actions", onPress: () => setWritingId(undefined) }] : [])]} footer={footer}>
    {alert}
    <ExchangeLog lines={[...(transcript === undefined ? [] : exchangeLines(child.name, transcript)),
      ...(child.retry ? [{ kind: "block" as const, key: "retry", content: <AlertCard label={`${child.name} is retrying`} tone="warn" title={retryCount(child.retry)}
        code={child.retry.error} codeLabel="Error" codeLines={6}>
        The model call failed. Forgerie tries again on its own, up to {child.retry.max} times. <strong>{retryWait(child.retry, now)}.</strong>
      </AlertCard> }] : []),
      ...(child.worktree?.cleanup?.kind === "failed" ? [{ kind: "block" as const, key: "cleanup-failed", content: <NoticeBar tone="alert" message={`The branch is ${child.worktree.state}, but folder cleanup failed: ${child.worktree.cleanup.error}`} actions={[]} /> }] : []),
      ...(outcome ? [{ kind: "block" as const, key: "worktree-result", content: <NoticeBar tone={outcome.kind === "landed" || outcome.kind === "discarded" ? "plain" : "alert"}
        message={resultText(outcome, branch)} actions={[{ label: "Dismiss", onPress: actions.onDismissOutcome },
          ...(outcome.kind === "conflict" ? [{ label: "Ask child to resolve", onPress: () => { void actions.onSend(child.conversationId, outcome.prompt).catch(() => {}); } }] : [])]} /> }] : [])]}
      follow={busy || question !== undefined || outcome !== undefined}
      empty={transcript === undefined ? "Reading the record…" : "No messages yet."} />
  </SheetDialog>;
}
