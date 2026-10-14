import { useState } from "react";
import type { TriggerFire } from "@shared/triggers";
import { NestedRows } from "../ui/NestedRows";
import { ActionRow } from "../ui/ActionRow";
import { TextButton } from "../ui/TextButton";
import { PROJECT_STATUS, projectsInOrder, type ProjectName } from "./triggerTargets";
import { firstLine } from "./triggerWords";

/** Past this many projects, the rest wait behind Show all. */
const FIRST = 6;

/**
 * Shape: one fire's outcome in each project, failures first: the project, how
 * it went, why when it did not start, and its session one press away. A
 * project skipped as unavailable is quiet: it does not need a look.
 */
export function FireProjects({ fire, projectName, narrow = false, onOpenSession }: {
  fire: TriggerFire;
  projectName: ProjectName;
  /** A narrow column: each status goes under its project's name. */
  narrow?: boolean | undefined;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}) {
  const [all, setAll] = useState(false);
  const ordered = projectsInOrder(fire.projects);
  const shown = all ? ordered : ordered.slice(0, FIRST);
  return <>
    <NestedRows label="Outcome in each project">
      {shown.map(({ cwd, outcome }) => {
        const name = projectName(cwd);
        const session = outcome.kind === "started" || (outcome.kind === "failed" && outcome.sessionId) ? outcome.sessionId : undefined;
        const why = outcome.kind === "failed" ? outcome.error : outcome.kind === "unavailable" ? outcome.reason : undefined;
        return <ActionRow key={cwd} layout={narrow ? "stacked" : "head"} name={name} status={PROJECT_STATUS[outcome.kind]}
          tone={outcome.kind === "failed" ? "danger" : outcome.kind === "unavailable" ? "quiet" : undefined}
          detail={why ? <span title={why}>{firstLine(why)}</span> : undefined}
          actions={session ? <TextButton label="Open session" title={`Open the session in ${name}`} onPress={() => onOpenSession({ id: session, cwd })} /> : undefined} />;
      })}
    </NestedRows>
    {ordered.length > FIRST ? <TextButton label={all ? "Show fewer projects" : `Show all ${String(ordered.length)} projects`} onPress={() => setAll(!all)} /> : null}
  </>;
}
