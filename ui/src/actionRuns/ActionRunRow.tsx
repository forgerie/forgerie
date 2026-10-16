import { MenuButton } from "../ui/MenuButton";
import { RunRow } from "../ui/RunRow";
import { WatchToggle } from "../ui/WatchToggle";
import { ago } from "../pullRequests/pullRequestModel";
import type { ActionRun, ActionRunLink } from "./actionRunApi";
import { permissionProblem, runFacts, runMark, runWord, watchable } from "./actionRunModel";
import { RunProblem } from "./RunProblem";

/**
 * Shape: one run in the Actions list or under a pull request. A linked run
 * opens its jobs here; a derived one opens on GitHub. The watch toggle and
 * Unlink are left out where the reader may not write.
 */
export function ActionRunRow({ runId, run, link, error, refusal, now, busy, writing, onOpen, onWatch, onUnlink }: {
  runId: number;
  run: ActionRun | null;
  /** Undefined for a derived run: GitHub lists it for a pull request's head, and nothing links it yet. */
  link?: ActionRunLink | undefined;
  /** Why the run could not be read. */
  error?: string | undefined;
  /** Why the last write for it was refused. */
  refusal?: string | undefined;
  now: number;
  busy: boolean;
  writing: boolean;
  onOpen?: (() => void) | undefined;
  onWatch?: ((on: boolean) => void) | undefined;
  onUnlink?: (() => void) | undefined;
}) {
  const watch = link?.watch ?? { kind: "off" as const };
  const name = run?.workflow ?? `Run #${String(runId)}`;
  const word = run ? runWord(run) : "Not read";
  const watching = watch.kind === "watching";
  const canWatch = onWatch !== undefined && (watching || watchable(run));
  const open = onOpen ? { label: `Open ${name} run #${String(runId)}, ${word}${run ? `: ${run.title}` : ""}`, onPress: onOpen }
    : run ? { label: `${name} run #${String(runId)}, ${word}: ${run.title}. Opens on GitHub.`, href: run.url } : undefined;
  const controls = <>
    {canWatch ? <WatchToggle on={watching} text={watching ? "Watching" : watch.kind === "stopped" ? "Watch again" : "Watch"} disabled={writing}
      count={watching ? watch.wakes : undefined} countText={watching && watch.wakes === 1 ? "wake" : "wakes"} what={`run #${String(runId)}`}
      onPress={() => onWatch(!watching)} /> : null}
    {onUnlink ? <MenuButton label={`More for run #${String(runId)}`} commands={[{ label: "Unlink from this session", tone: "danger", disabled: writing,
      confirm: watching ? "Unlink it? Its watch stops too." : undefined, onSelect: onUnlink }]} /> : null}
  </>;
  const note = watch.kind === "stopped" ? `Stopped: ${watch.reason.replace(/\.$/u, "")}.`
    : watch.kind === "watching" && watch.error ? `The last read failed: ${watch.error}` : undefined;
  return <RunRow state={run ? runMark(run) : "unknown"} stateText={word} name={name} title={run && run.title !== run.workflow ? run.title : undefined} facts={run ? runFacts(run) : []}
    age={run ? ago(run.createdAt, now) : undefined} ageLabel={run ? `Started ${new Date(run.createdAt).toLocaleString()}` : undefined}
    open={open ?? { label: `Open run #${String(runId)}`, href: `https://github.com/${link?.repo ?? ""}/actions/runs/${String(runId)}` }}
    controls={canWatch || onUnlink ? controls : undefined} note={note} busy={busy}
    problem={refusal ? { tone: permissionProblem(refusal) ? "warn" : "bad", content: <RunProblem error={refusal} subject="this run" /> }
      : error ? { tone: permissionProblem(error) ? "warn" : "bad", content: <RunProblem error={error} subject="this run" lead="Forgerie could not read this run." /> } : undefined} />;
}
