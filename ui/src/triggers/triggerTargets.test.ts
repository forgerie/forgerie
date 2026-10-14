import { describe, expect, it } from "vitest";
import type { TriggerWorkflowsResponse } from "@shared/triggers";
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
  it("uses structured project paths even when a path contains ' and /'", () => {
    const first = "/projects/one and /nested";
    const second = "/projects/two";
    const name = (cwd: string) => cwd === first ? "First project" : cwd === second ? "Second project" : cwd;
    const diagnostics: TriggerWorkflowsResponse["diagnostics"] = [{
      name: "nightly", path: `${second}/.pi/prompts/nightly.md`,
      error: `Workflow input declarations differ between ${first} and ${second}`,
      reason: "inputs-differ", cwds: [first, second],
    }];
    expect(gapShort("nightly", diagnostics, name)).toBe("Inputs differ between First project and Second project");
    expect(workflowGap("nightly", { workflows: [], diagnostics }, name)).toBe(
      "“nightly” cannot run in every target project. Its inputs differ between First project and Second project. Choose another workflow, or change the projects.");
  });

  it.each([
    ["missing", "Missing in pi-mono", "It is missing in pi-mono."],
    ["script", "A script in pi-mono", "It is a script in pi-mono, and scripts cannot run on a schedule."],
    ["unreadable", "Cannot be read in pi-mono", "pi-mono: Could not load workflow"],
    ["inputs-differ", "Inputs differ between forgerie and pi-mono", "Its inputs differ between forgerie and pi-mono."],
  ] as const)("uses the %s reason and cwds regardless of the error text or workflow file path", (reason, short, detail) => {
    const diagnostics = [{ name: "nightly", path: `${CALIPER}/.pi/prompts/nightly.md`, error: "Could not load workflow", reason,
      cwds: reason === "inputs-differ" ? [FORGERIE, PI_MONO] : [PI_MONO] }];
    expect(gapShort("nightly", diagnostics, projectLabel)).toBe(short);
    expect(workflowGap("nightly", { workflows: [], diagnostics }, projectLabel)).toContain(detail);
  });

  it("names unreadable projects from cwds rather than the diagnostic file path", () => {
    expect(workflowGap("nightly", { workflows: [], diagnostics: [{
      name: "", path: `${PI_MONO}/.pi/prompts`, error: "ENOENT", reason: "unreadable", cwds: [PI_MONO],
    }] }, projectLabel)).toContain("Forgerie could not read pi-mono.");
  });
  it("says which project lacks it and which declares other inputs", () => {
    const common = commonWorkflows(fixed(FORGERIE, PI_MONO));
    expect(workflowGap("refine-backlog", common, projectLabel)).toBe(
      "“refine-backlog” cannot run in every target project. It is missing in pi-mono. Choose another workflow, or change the projects.");
    expect(workflowGap("triage-issues", common, projectLabel)).toBe(
      "“triage-issues” cannot run in every target project. Its inputs differ between forgerie and pi-mono. Choose another workflow, or change the projects.");
    expect(gapShort("triage-issues", common.diagnostics, projectLabel)).toBe("Inputs differ between forgerie and pi-mono");
    expect(workflowGap("nightly-report", common, projectLabel)).toContain("It is a script in forgerie, and scripts cannot run on a schedule.");
    expect(workflowGap("docs-sweep", common, projectLabel)).toBeUndefined();
    expect(gapShort("refine-backlog", common.diagnostics, projectLabel)).toBe("Missing in pi-mono");
  });
  it("reads the server's inputs text, which names the two projects it compared", () => {
    // The server compares with the first target that has the workflow, so a missing first target adds no inputs line.
    const diagnostics = [
      { name: "nightly", path: `${PI_MONO}/.pi/prompts/nightly.md`, error: `Workflow is unavailable in ${FORGERIE}` },
      { name: "nightly", path: `${CALIPER}/.pi/prompts/nightly.md`, error: `Workflow input declarations differ between ${PI_MONO} and ${CALIPER}` },
    ];
    expect(gapShort("nightly", diagnostics, projectLabel)).toBe("Missing in forgerie. Inputs differ between pi-mono and caliper");
    expect(workflowGap("nightly", { workflows: [], diagnostics }, projectLabel)).toBe("“nightly” cannot run in every target project. It is missing in forgerie. "
      + "Its inputs differ between pi-mono and caliper. Choose another workflow, or change the projects.");
    // Several pairs share the first project: each project shows once.
    const pairs = [`${PI_MONO} and ${CALIPER}`, `${PI_MONO} and ${FORGERIE}`].map((pair) => ({ name: "n", path: "/x", error: `Workflow input declarations differ between ${pair}` }));
    expect(gapShort("n", pairs, projectLabel)).toBe("Inputs differ between pi-mono, caliper, and forgerie");
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
    expect(fireCountWords({ projects: [{ cwd: FORGERIE, outcome: { kind: "running", startedAt: 0 } }, { cwd: PI_MONO, outcome: { kind: "failed", error: "x" } },
      { cwd: CALIPER, outcome: { kind: "started", sessionId: "s", runId: "r" } }] })).toBe("1 of 3 started, 1 failed, 1 still starting");
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
