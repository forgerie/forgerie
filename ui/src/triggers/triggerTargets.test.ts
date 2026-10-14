import { describe, expect, it } from "vitest";
import {
  fireCountWords, gapShort, projectsInOrder, targetChip, targetHint, targetNames, targetsKey, targetSummary, workflowGap,
} from "./triggerTargets";
import { lastRunWords, outcomeWords, stripMarks, stripWords, type WordClock } from "./triggerWords";
import { CALIPER, commonWorkflows, everywhere, FORGERIE, HOST_ZONE, nightly, NOW, OLD_SITE, PI_MONO, spreadNotes } from "./fixtures/triggers";
import { projectLabel } from "./fixtures/scenario";

const clock: WordClock = { now: NOW, locale: "en-US", browserZone: HOST_ZONE, hostZone: HOST_ZONE };
const fixed = (...cwds: string[]) => ({ kind: "projects" as const, cwds });

describe("target projects in words", () => {
  it("names one project, counts several, and says all projects", () => {
    expect(targetChip(fixed(FORGERIE), projectLabel)).toBe("forgerie");
    expect(targetChip(fixed(FORGERIE, PI_MONO, CALIPER), projectLabel)).toBe("3 projects");
    expect(targetChip({ kind: "all" }, projectLabel)).toBe("all projects");
    expect(targetChip(fixed(), projectLabel)).toBeUndefined();
    expect(targetSummary({ kind: "all" }, projectLabel)).toBe("All projects");
    expect(targetNames(fixed(FORGERIE, PI_MONO), projectLabel)).toBe("forgerie, pi-mono");
  });
  it("says what one fire starts, and that All projects includes projects added later", () => {
    expect(targetHint(fixed(FORGERIE))).toBe("Each run starts a new session in this folder.");
    expect(targetHint(fixed(FORGERIE, PI_MONO))).toBe("Each run starts a new session in each of these projects, at once.");
    expect(targetHint({ kind: "all" })).toContain("Projects added later are included.");
  });
  it("keys a selection by its projects, not the order they were checked in", () => {
    expect(targetsKey(fixed(PI_MONO, FORGERIE))).toBe(targetsKey(fixed(FORGERIE, PI_MONO)));
    expect(targetsKey({ kind: "all" })).toBe("all");
  });
});

describe("a workflow the target projects do not share", () => {
  it("says which project lacks it and which declares other inputs", () => {
    const common = commonWorkflows(fixed(FORGERIE, PI_MONO));
    expect(workflowGap("refine-backlog", common, projectLabel)).toBe(
      "“refine-backlog” cannot run in every target project. It is missing in pi-mono. Choose another workflow, or change the projects.");
    expect(workflowGap("triage-issues", common, projectLabel)).toContain("It asks for different inputs in pi-mono.");
    expect(workflowGap("nightly-report", common, projectLabel)).toContain("It is a script in forgerie, and scripts cannot run on a schedule.");
    expect(workflowGap("docs-sweep", common, projectLabel)).toBeUndefined();
    expect(gapShort("refine-backlog", common.diagnostics, projectLabel)).toBe("Missing in pi-mono");
  });
  it("says when a project could not be read at all", () => {
    expect(workflowGap("docs-sweep", commonWorkflows(fixed(FORGERIE, OLD_SITE)), projectLabel)).toContain("It is missing in old-site.");
    expect(workflowGap("docs-sweep", { workflows: [], diagnostics: [{ name: "", path: OLD_SITE, error: "ENOENT" }] }, projectLabel))
      .toContain("Forgerie could not read old-site.");
  });
});

describe("a fire in several projects", () => {
  const partly = everywhere.history[0]!;
  it("counts the projects: started of all, then what else happened", () => {
    expect(fireCountWords(partly)).toBe("2 of 4 started, 1 failed, 1 unavailable");
    expect(fireCountWords(spreadNotes.history[0]!)).toBe("3 of 3 started");
  });
  it("lists failures first and unavailable projects last", () => {
    expect(projectsInOrder(partly.projects).map((item) => item.cwd)).toEqual([PI_MONO, FORGERIE, CALIPER, OLD_SITE]);
  });
  it("words the row and the last-run line by count, and keeps one project's words as they were", () => {
    expect(outcomeWords(partly, HOST_ZONE, clock)).toBe("Oct 12, 4:00 AM: 2 of 4 started, 1 failed, 1 unavailable");
    expect(lastRunWords(partly, HOST_ZONE, clock)).toBe("Last run Oct 12 at 4:00 AM: 2 of 4 started, 1 failed, 1 unavailable.");
    expect(lastRunWords(nightly.history[2], HOST_ZONE, clock)).toBe("Last run Oct 10 at 3:00 AM started a session.");
  });
  it("draws a fire that only skipped unavailable projects as a plain mark, never as trouble", () => {
    const skipped = { ...partly, outcome: { kind: "unavailable" as const, reason: "gone" }, projects: [{ cwd: OLD_SITE, outcome: { kind: "unavailable" as const, reason: "gone" } }] };
    expect(stripMarks([skipped], false)).toEqual(["plain"]);
    expect(stripWords([skipped])).toBe("Last run: 1 unavailable.");
    expect(outcomeWords(skipped, HOST_ZONE, clock)).toBe("Unavailable Oct 12: gone");
  });
});
