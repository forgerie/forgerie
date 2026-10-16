import { JobList, type JobListItem } from "../ui/JobList";
import { RunDetail } from "../ui/RunDetail";
import { WatchToggle } from "../ui/WatchToggle";
import { ago, duration } from "../pullRequests/pullRequestModel";
import type { ActionRunItem } from "./actionRunApi";
import { jobSeconds, permissionProblem, runFacts, runMark, runSentence, runSeconds, sortedJobs, watchable, watchNote } from "./actionRunModel";
import type { RunDetailState } from "./actionRunsStore";
import { RunProblem } from "./RunProblem";

const JOB_WORD = { queued: "Queued", running: "Running", passed: "Passed", failed: "Failed", cancelled: "Cancelled", skipped: "Skipped" } as const;
const EVENT_WORD: Record<string, string> = { push: "push", pull_request: "pull request", workflow_dispatch: "dispatch", schedule: "schedule" };

/**
 * Shape: one linked run, opened from the Actions list: where it stands, its
 * watch, and its jobs, failures first with their annotations.
 */
export function ActionRunDetail({ item, detail, refusal, now, writing, readOnly, onBack, onWatch, onUnlink }: {
  item: ActionRunItem;
  detail: RunDetailState["load"];
  /** Why the last write for this run was refused. */
  refusal?: string | undefined;
  now: number;
  writing: boolean;
  readOnly: boolean;
  onBack: () => void;
  onWatch: (on: boolean) => void;
  onUnlink: () => void;
}) {
  const { link, run } = item;
  const id = `#${String(link.runId)}`;
  const problem = refusal ?? (detail.type === "failed" ? detail.message : item.error);
  const notice = problem ? { tone: permissionProblem(problem) ? "warn" as const : "bad" as const,
    content: <RunProblem error={problem} subject="this run" lead={refusal ? undefined : "Forgerie could not read this run."} /> }
    : detail.type === "loading" ? { tone: "quiet" as const, content: <p>{run ? "Reading the jobs again from GitHub…" : "Reading the run from GitHub…"}</p> } : undefined;
  const watching = link.watch.kind === "watching";
  const control = !readOnly && (watching || watchable(run)) ? <WatchToggle on={watching} disabled={writing} count={link.watch.kind === "watching" ? link.watch.wakes : undefined}
    text={watching ? "Stop watching" : link.watch.kind === "stopped" ? "Watch again" : "Watch"}
    countText="wakes" what={`run ${id}`}
    onPress={() => onWatch(!watching)} /> : null;
  const note = watchNote(link.watch) ?? (run && !watchable(run) ? "It finished, so there is nothing left to watch." : "Wake the agent when a job fails, a new attempt starts, and when the run finishes.");
  const longest = Math.max(0, ...(run?.jobs ?? []).map((job) => jobSeconds(job) ?? 0));
  const jobs: JobListItem[] = run ? sortedJobs(run.jobs).map((job) => {
    const seconds = jobSeconds(job);
    return { id: job.id, name: job.name, state: job.state, stateText: JOB_WORD[job.state], url: job.url, log: job.logTail,
      time: seconds === undefined ? undefined : duration(seconds), share: seconds === undefined || longest === 0 ? undefined : seconds / longest };
  }) : [];
  const passed = run?.jobs.filter((job) => job.state === "passed").length ?? 0;
  const took = run ? runSeconds(run) : undefined;
  const facts = run ? [...runFacts(run).slice(1),
    { text: `${EVENT_WORD[run.event] ?? run.event.replaceAll("_", " ")} by ${run.actor}`, label: "Trigger" },
    ...run.pullNumbers.map((number) => ({ text: `#${String(number)}`, label: `Pull request #${String(number)}`, code: true })),
    { text: `started ${ago(run.createdAt, now)} ago`, label: new Date(run.createdAt).toLocaleString() },
    ...took === undefined ? [] : [{ text: `took ${duration(took)}`, label: "Duration" }]] : [];
  return <RunDetail back={{ label: "All runs", onPress: onBack }} external={run ? { label: "Open on GitHub", href: run.url } : undefined}
    name={run?.workflow ?? "Run"} number={id} title={run?.title ?? (detail.type === "loading" ? "Reading…" : "Not read")} facts={facts}
    state={run ? runMark(run) : "unknown"} sentence={run ? runSentence(run) : "Forgerie has not read this run."} notice={notice}
    watch={{ note, control }} sectionTitle="Jobs"
    sectionCount={run && run.jobs.length > 0 ? `${String(passed)} of ${String(run.jobs.length)} passed` : undefined}
    remove={readOnly ? undefined : { label: `Unlink run ${id} from this session.`, note: watching ? "Its watch stops too." : undefined, disabled: writing, onPress: onUnlink }}>
    {/* A first read with jobs opens the first failure; later reads keep what the reader opened. */}
    <JobList key={`${String(run?.attempt ?? 0)}:${String(jobs.length > 0)}`} label={`Jobs of run ${id}`} jobs={jobs} linkText="Full job on GitHub" logLabel="Annotations"
      empty={run ? (run.status === "completed" ? "GitHub reports no jobs for this run." : "No job has started yet.") : "Read the run to see its jobs."}
      fold={{ states: ["passed", "skipped"], closed: `${String(jobs.filter((job) => job.state === "passed" || job.state === "skipped").length)} passed or skipped`, open: "Hide the passed and skipped jobs" }} />
  </RunDetail>;
}
