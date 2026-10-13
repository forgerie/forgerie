---
description: Review yesterday's commits and make small architectural refinements for the user to land in the morning
workflow:
  version: 1
  inputs:
    focus:
      type: string
      description: Optional area to prefer, such as a folder or a concern. Empty means the whole day's work.
      default: ""
    max_changes:
      type: number
      choices: [1, 2, 3]
      default: 2
  stages:
    - id: survey
      name: Survey yesterday
      does: "This chat reads the previous local day's commits on main and picks the refinements."
    - id: refine
      name: Refine
      workers:
        - { name: refine, agent: full-stack-engineer }
    - id: review
      name: Review
      workers:
        - { name: review, agent: reviewer }
    - { id: land, name: Land, stop: land }
---
This run starts at night with nobody watching. The user reads the result in the morning and decides at the land stop. Do not ask the user questions during the run. Make reasonable choices and record them in the land summary.

## Survey

Read the commits on `main` from the previous local calendar day (00:00 to 24:00 in the host's time zone): `git log main --since=<yesterday 00:00> --until=<today 00:00> --stat`. Read the diffs that matter. Read `AGENTS.md`, `CONTEXT.md`, and the `code-quality-architecture` skill first.

Look for architectural refinements that the day's work made worth doing:
- duplicated logic that two of yesterday's changes added in different places;
- a module that grew a second responsibility;
- a seam, type, or state model that a new feature bent out of shape;
- a name that no longer says what the code does;
- a test that checks implementation shape instead of behaviour.

If the `focus` input is not empty, prefer that area.

Pick at most `max_changes` refinements. Each one must be small, behaviour-preserving, and reviewable in a few minutes. Do not pick feature work, bug fixes that change behaviour, dependency upgrades, formatting sweeps, or anything that touches deployment, CI, or secrets. Skip anything another open worktree branch is already changing.

If there were no commits, or nothing meets this bar, do not spawn any worker. Call `workflow_finish` with outcome `stopped` and a short result that says what you read and why nothing was worth changing. A quiet night is a good result.

## Refine

Spawn `refine` once with `isolation: "worktree"`. Give it the chosen refinements, each with the commits that motivate it, the files involved, and the behaviour that must not change. It makes one commit per refinement, with a message that names the motivating commit. It runs `npm run verify` on Node 24 (`nix shell nixpkgs#nodejs_24 -c npm run verify`). If a test times out under load, it reruns that file alone before changing anything. It does not land, merge, push, restart services, or deploy.

## Review

Spawn `review` on the refine branch. It checks that behaviour is unchanged, that each refinement is justified by yesterday's commits, and that tests still prove behaviour. Send blockers back to `refine` once. If a blocker remains after that, drop that refinement: have `refine` revert its commit, and say so in the summary.

## Land

Call `workflow_stop` for `land` with a summary the user can judge in one minute:
- the commits you read, by subject;
- each refinement: what changed, why yesterday's work called for it, and the files;
- the verify result and the review verdict;
- anything you considered and skipped, with the reason.

After the user decides, call `workflow_finish`.
