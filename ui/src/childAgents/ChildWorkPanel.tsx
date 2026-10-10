import { useState } from "react";
import { SheetDialog } from "../ui/SheetDialog";
import { ActionFooter } from "../ui/ActionFooter";
import { NoticeBar } from "../ui/NoticeBar";
import { Disclosure } from "../ui/Disclosure";
import { CodeEditor } from "../ui/CodeEditor";
import { ListSection } from "../ui/ListSection";
import { ToggleGroup } from "../ui/ToggleGroup";
import { ActionRow } from "../ui/ActionRow";
import { type ChildDetail, money, runCost, totalCost } from "./childWorkModel";

/** The reader's review, confirmation, history, or last cleanup report. All data comes from the same edge as the child list. */
export function ChildWorkPanel({ detail, pending, error, onBack, onClose, onDiscard, onRefresh }: {
  detail: Exclude<ChildDetail, { kind: "none" }>;
  pending?: string | undefined;
  error?: string | undefined;
  onBack: () => void;
  onClose: () => void;
  onDiscard: (token: string) => void;
  onRefresh: () => void;
}) {
  const [agent, setAgent] = useState("");
  const title = detail.kind === "loading" ? detail.title : detail.kind === "review" ? "Review changes"
    : detail.kind === "discard" ? "Discard worktree?" : detail.kind === "runs" ? "Run history" : detail.kind === "cleanup" ? "Worktrees" : "Could not load";
  const report = detail.kind === "cleanup" ? detail.data.phase === "done" ? detail.data.report : "previous" in detail.data ? detail.data.previous : undefined : undefined;
  return <SheetDialog title={title} closeLabel="Close child agents" onClose={onClose} back={{ label: "Back to child agents", onPress: onBack }}
    actions={detail.kind === "loading" ? [] : [{ label: "Refresh", onPress: onRefresh, disabled: pending !== undefined }]}
    footer={detail.kind === "discard" ? <ActionFooter note="This deletes these commits, uncommitted files, and ignored files. This cannot be undone here."
      actions={[{ label: "Keep worktree", onPress: onBack, disabled: pending !== undefined },
        { label: pending ? "Discarding…" : "Discard worktree", tone: "danger", disabled: pending !== undefined, onPress: () => onDiscard(detail.data.confirmationToken) }]} /> : undefined}>
    {error && <NoticeBar tone="alert" message={error} actions={[]} />}
    {detail.kind === "loading" && <p role="status">Loading…</p>}
    {detail.kind === "failed" && <NoticeBar tone="alert" message={detail.message} actions={[]} />}
    {detail.kind === "review" && <>
      <p>Changes against the default branch, including inherited parent commits. Read at {detail.data.head.slice(0, 8)}. Refresh after the child makes more changes.</p>
      {detail.data.sections.map((section) => <Disclosure key={`${section.label}:${detail.data.head}`} summary={section.label}>
        {section.truncated && <p>Diff truncated. Review the full change in the worktree before landing.</p>}
        {section.diff ? <CodeEditor key={section.diff} label={section.label} fileName="changes.diff" text={section.diff} readOnly onChange={() => {}} onSave={() => {}} /> : <p>No changes.</p>}
      </Disclosure>)}
      <ListSection title="Untracked files" empty="No untracked files." note="These files are not committed. Their contents are not included in this diff.">
        {detail.data.untracked.map((path) => <ActionRow key={path} name={path} />)}
      </ListSection>
    </>}
    {detail.kind === "discard" && <>
      <p><code>{detail.data.branch}</code> will be removed. The following commits are not on <code>{detail.data.defaultBranch}</code>.</p>
      <ListSection title="Commits to discard" empty="No unlanded commits.">{detail.data.commits.map((commit) => <ActionRow key={commit.sha} name={commit.subject} detail={commit.sha} />)}</ListSection>
      <ListSection title="Uncommitted files to discard" empty="No uncommitted files.">{detail.data.dirtyFiles.map((path) => <ActionRow key={path} name={path} />)}</ListSection>
    </>}
    {detail.kind === "runs" && <>
      <p>Estimated cost: {totalCost(detail.data)}. Records stay for {detail.data.retentionDays} days. Model and tool costs are separate from billing; missing usage is unknown, not free.</p>
      <ToggleGroup label="Filter by agent" value={agent} onChange={setAgent} options={[{ value: "", label: "All agents" },
        ...[...new Set(detail.data.records.map((run) => run.child.agent))].map((name) => ({ value: JSON.stringify(name), label: name ?? "General helper" }))]} />
      {detail.data.records.filter((run) => !agent || JSON.stringify(run.child.agent) === agent).map((run) => <Disclosure key={run.id}
        summary={`${run.child.name} · ${run.state.kind === "running" ? "Working" : run.state.outcome} · ${money(runCost(run))}`}>
        <p>{run.model ? `${run.model.provider}/${run.model.modelId}` : "Model not recorded"}. {run.turns} turns.</p>
        <p>Started {new Date(run.startedAt).toISOString()}{run.state.kind === "finished" ? `. Duration ${(run.state.durationMs / 1000).toFixed(1)} seconds${run.state.timing === "recovered" ? ", recovered after restart" : ""}` : ""}.</p>
        <p>Model tokens: {run.usage === null ? "unknown" : Object.values(run.usage.models).reduce((sum, value) => sum + value.totalTokens, 0)}. Tool tokens: {run.usage === null ? "unknown" : Object.values(run.usage.tools).reduce((sum, value) => sum + value.totalTokens, 0)}.</p>
        {run.child.agentFile && <p>Agent file: {run.child.agentFile.path}<br />SHA-256: {run.child.agentFile.sha256}</p>}
        <p>Session: {run.session.id}<br />Folder: {run.session.cwd}</p>
      </Disclosure>)}
      {detail.data.records.length === 0 && <p>No recorded runs for this session yet.</p>}
    </>}
    {detail.kind === "cleanup" && <>
      <p>This is the last cleanup report for all owned worktrees, not a live scan. Refresh only reads the report. Cleanup keeps dirty, unmerged, and in-use worktrees.</p>
      {detail.data.phase === "never-run" && <p>No cleanup has run yet.</p>}
      {detail.data.phase === "running" && <p role="status">Cleanup is running. The previous report appears below when available.</p>}
      {detail.data.phase === "failed" && <NoticeBar tone="alert" message={detail.data.error} actions={[]} />}
      {report && <><p>Completed {report.finishedAt}.</p>
        <ListSection title="Kept" empty="No kept worktrees in this report.">{report.kept.map((item) => <ActionRow key={item.id} name={item.branch} status={item.reason} detail={<>{item.path}{item.detail && <p>{item.detail}</p>}</>} />)}</ListSection>
        <ListSection title="Removed" empty="No worktrees removed in this report.">{report.removed.map((item) => <ActionRow key={item.id} name={item.branch} detail={item.path} />)}</ListSection>
      </>}
    </>}
  </SheetDialog>;
}
