---
description: Make evidence-backed architectural improvements overnight, report completed work, and wait for approval before rebasing, verifying, and fast-forwarding main
workflow:
  version: 1
  inputs:
    focus:
      type: string
      description: Optional responsibility or area to prefer. Empty means infer scope from recent changes.
      default: ""
    base_branch:
      type: string
      default: main
    since_commit:
      type: string
      description: Optional commit from the last completed review. Empty means inspect recent history without claiming an incremental baseline.
      default: ""
    history_commits:
      type: number
      choices: [100, 150, 300]
      default: 150
    max_changes:
      type: number
      choices: [1, 2, 3]
      default: 2
    review_rounds:
      type: number
      choices: [1, 2, 3]
      default: 2
    max_minutes:
      type: number
      choices: [60, 120, 180]
      default: 120
  stages:
    - id: scope
      name: Establish scope
      workers:
        - { name: history-scout, agent: scout }
    - id: explore
      name: Explore responsibilities
      workers:
        - { name: scout-one, agent: scout }
        - { name: scout-two, agent: scout }
        - { name: scout-three, agent: scout }
    - id: implement
      name: Implement and test
      workers:
        - { name: engineer, agent: full-stack-engineer }
    - id: review
      name: Independently review
      workers:
        - { name: reviewer, agent: reviewer }
    - id: report
      name: Explain completed work
      workers:
        - { name: report-writer, agent: design-engineer }
    - id: approve-landing
      name: Approve landing
      does: Approve the reported commits for rebase, verification, and fast-forward into the base branch.
      stop: approve
    - id: land
      name: Rebase, verify, and fast-forward
      does: This chat lands only the verified rebased commit after approval, then follows the project's deployment policy.
---
# Nightly architecture improvement

Complete useful work while the user is away. Deliver a report about changes made, not candidates awaiting selection. The morning decision is whether to land the reported commits. This workflow replaces the proposal-and-grilling process; do not invoke `improve-codebase-architecture` or wait for candidate selection.

## Ownership and limits

One invocation owns one registered project: the project of the launching session. The future global trigger owns project selection, scheduling, dispatch, and the cross-project digest. Do not implement a second scheduler, discover extra projects to modify, or loop over arbitrary repository paths. This file neither enables a trigger nor chooses a firing time.

Read the project's instructions, domain glossary or `CONTEXT.md`, relevant ADRs, engineering principles, architecture guidance, and testing guidance. Use `codebase-design` for architectural reasoning when available. Missing optional skills do not excuse missing evidence or tests. Follow the project's actual tools, not Forgerie-specific commands copied into other projects.

Before approval, all source changes stay on one isolated implementation branch. Do not land, merge, push, deploy, publish, restart shared services, file issues, or alter production data. Do not change credentials, permissions, network settings, dependencies, public contracts, persisted schemas, or product policy. Respect existing ADRs. Record opportunities needing those changes as deferred, then continue independent work.

Allow behavior-preserving refactors and bug fixes whose expected behavior is established by existing requirements, callers, or tests. Evidence of awkward code alone does not authorize a behavior change. Choose at most `max_changes` improvements with a bounded scope and a practical verification path. No cosmetic sweeps, speculative abstractions, or quota of findings.

Use `max_minutes` as a coordination deadline from run start, not a claimed hard runtime or spend cap. Reserve time for review and reporting. At the deadline, stop expanding scope, settle active children, and report what passed and what remains incomplete. Do not ask routine questions overnight. Defer work that needs new authority instead of starting an approval request that blocks the whole project.

## 1. Establish scope

Verify the real repository root, registered project, coordinator worktree, base branch, current HEAD, and working-tree status. Resolve `base_branch` as an existing local branch and capture its full commit SHA. Preserve unrelated files. The implementation branch must start from that captured SHA, not inherit unlanded coordinator changes. If the available worktree mechanism cannot do that safely, report the blocker instead of resetting someone's checkout.

Inspect available run records and worktrees for an active or awaiting-approval run of this workflow in this project. If one exists, link it and finish this duplicate invocation as `stopped`. Also exclude work already in progress on overlapping paths. Do not claim a durable concurrency lock from this prompt-level check; atomic admission belongs to the trigger infrastructure.

Spawn `history-scout` with `agent: scout` and shared, read-only isolation. Ask it to inspect `history_commits` commits ending at the captured base, identify recurring responsibility pressure, separate mechanical migrations, follow renamed paths where needed, and return commits, paths, and relevant domain decisions. Verify its strongest leads against source yourself.

If `since_commit` is supplied, verify that it resolves to a commit and is an ancestor of the captured base. Focus selection on that range, while using older history for context. If the range is empty, report no changes and finish as `stopped` without expensive exploration. An invalid or divergent baseline is a blocker, not permission to silently review another range. Without a supplied baseline, do not invent a last-reviewed commit or a daily cutoff.

Completion: record the captured revision, actual history range, optional baseline, and bounded areas selected for investigation. If no worthwhile area remains, deliver a short no-change result and finish as `stopped`.

## 2. Explore and select

Spawn only the needed `scout-one`, `scout-two`, and `scout-three` children using `agent: scout` and shared, read-only isolation. Give them distinct responsibilities at the captured revision. Run independent scopes in parallel where supported.

Require caller traces, source paths and line ranges, existing tests, counterevidence, relevant ADRs, and a deletion-test assessment. Ask what responsibility moves, what callers no longer need to know, and which already-deep modules must remain intact. Scout conclusions are leads, not proof.

Verify the selected claims directly. Classify evidence as Reproduced, Found in code, or Inferred. Attempt a controlled reproduction for claimed failures through the real module, using temporary data rather than live systems. Reject weak or unsafe candidates. Compare accessible previous reports to distinguish new findings from unchanged ones; absence from a report is not proof of resolution.

Completion: each selected improvement has a concrete before-state, intended invariant or documented correction, bounded files, verification commands, and an explicit reason it is worth doing now.

## 3. Implement and test

Spawn `engineer` with `agent: full-stack-engineer` and worktree isolation. Confirm its branch starts at the captured base before it edits files. Use this one branch for all implementation commits; do not create one writer per finding or nested worktrees. Give the engineer the selected evidence, contracts, exclusions, and deadline.

For a bug fix, first add a regression test that fails for the claimed reason on the before-state. Then implement the smallest justified change and show it passes. For a refactor, preserve behavior tests and add tests through the public contract where coverage is missing. Run the project's required static, unit, integration, build, and visual checks as applicable. Read frontend and intrinsic-design guidance before touching UI; use a design-engineer for UI implementation when needed, with sequential ownership of the same branch.

Create one reviewable commit per independent improvement. Include required release fragments and update domain documentation only where the implemented change makes it necessary. Record exact commands, outcomes, environmental blockers, final SHA, and the branch path. Skipped, timed-out, or unloadable tests are not passes. Missing dependencies do not authorize upgrades or bypassed checks.

Completion: only completed, verified improvements are candidates for landing. Remove an abandoned improvement with a targeted revert of this run's own commit, not a reset or clean of unrelated work. Reverify the resulting branch. If nothing remains, report the outcome and finish as `stopped` or `failed` as appropriate.

## 4. Independently review

Spawn `reviewer` with `agent: reviewer` and read-only isolation. Explicitly give it the engineer's actual worktree path, captured base SHA, final commit SHA, selected requirements, test evidence, and excluded scope. Review the real diff and callers, not the engineer's summary or the reviewer's default checkout.

Check correctness, preserved behavior, documented bug-fix expectations, architectural benefit, regressions, and scope. Independently run the relevant verification where practical. Send blockers back to the same engineer for at most `review_rounds` correction rounds. Re-review the final SHA after every correction or revert. If a blocker remains, exclude that change and verify the retained result; otherwise mark the run blocked. Never label a branch ready while required checks or review remain incomplete.

Completion: a clean implementation branch, exact approved-for-presentation SHA, independent verdict, complete verification record, and no unsettled implementation children.

## 5. Report before asking to land

The morning report is an account of completed work. Keep the skill's visual explanation, not its candidate-selection question. Spawn `report-writer` with `agent: design-engineer`, constrained to report artifacts only. Give it the verified evidence and actual commits; it must not add claims or production changes. Load frontend-design, intrinsic-design, simple-english, and unslop before writing the report.

Write a self-contained HTML visual essay plus a plain Markdown summary. Use the session's durable artifact location, outside the disposable implementation worktree and outside `/tmp`. Prefer an existing ignored `.forgerie/attachments/nightly-architecture/<run-id>/` in the coordinator workspace when supported. Do not modify ignore rules or commit generated reports merely to hide them. If durable delivery is unavailable, preserve the report at an explicitly named persistent location and mark delivery blocked.

Explain the system in domain terms before showing code. For each retained improvement include:
- the previous responsibility and concrete consequence;
- what changed, with before-and-after responsibility diagrams grounded in the diff;
- why the change reduces caller knowledge or concentrates responsibility;
- regression evidence, test results, independent review, and exact commit links;
- trade-offs, remaining uncertainty, and a practical rollback note.

Include deferred and reverted work, no-change areas, captured base and final SHA, branch/worktree paths, verification commands, and available cost or duration measurements. Never invent measurements. Collapse detailed engineering evidence without hiding limitations. Status is `ready to land`, not shipped or deployed.

Verify the report in a real browser at generous, medium, narrow-tall, tiny, and wide-short sizes. Check diagrams, readable text, links, overflow, and no-JavaScript readability. Publish through the existing authenticated workspace preview or artifact route. Verify the exact browser-accessible URL before sharing it. Do not start a per-report HTTPS server, request certificates, or present `file://` as remote delivery.

Post the report link and Markdown summary in the session before the approval stop. If visual delivery fails, still post the complete Markdown result and artifact paths, clearly state the failure, and finish as `failed` without declaring the package ready. The work remains available; report failure never authorizes discarding it.

Completion: report delivered, evidence checked against the final SHA, and all child work and completion reports settled.

## 6. Morning approval

Call `workflow_stop` for `approve-landing` and end the turn. Summarize the actual commits, base branch, report link, checks, reviewer verdict, exclusions, and proposed post-landing deployment behavior. State that approval authorizes rebasing these commits, verifying the rebased result, then fast-forwarding the base branch. Explain that conflicts or failed verification prevent landing.

Use `stop: approve`, not `stop: land`: the current built-in Land action rebases and immediately fast-forwards without an intervening verification step. This explicit approval gate preserves the user's decision while letting the coordinator test before main changes. Do not claim the trigger library's `hasLandStop` flag represents this custom approval gate.

While waiting, do not rebase, merge, deploy, or report the workflow as completed. A request for changes returns to implementation, independent review, and an updated report before asking again. Rejection leaves the branch and artifacts intact; do not delete them without separate authority.

## 7. After approval: rebase, verify, fast-forward

Act only after approval of `approve-landing` arrives. Verify that the implementation branch still has the reported SHA and no unrelated changes. Verify the base checkout is on `base_branch`, has no conflicting work or active Git operation, and is safe to update. Record its current SHA. Stop rather than stash, reset, switch someone else's checkout, or discard files.

Rebase the approved implementation commits onto that current base SHA inside the implementation worktree. If rebase conflicts, abort only the rebase this run started, preserve the branch, and report blocked. Do not silently resolve conflicts or expand the approved scope. Rerun the required verification against the rebased result. Any failure leaves the base branch unchanged and the run blocked. Material code corrections after approval require independent review, an updated report, and fresh user approval in a subsequent run; the old approval is not authority for a different solution.

Record the verified rebased SHA and check that the base SHA has not moved during verification. If it moved, leave it unchanged and report that landing needs another rebase-and-verification attempt. If stable, fast-forward the base checkout to the exact verified SHA using `git merge --ff-only <verified-sha>`. Do not invoke a helper that rebases again after verification, merge an unverified branch tip, force-update a ref, or create a merge commit. Confirm the resulting base HEAD equals the verified SHA; a concurrent update that prevents this is a blocker, not a reason to force it.

Follow the project's deployment policy only after successful landing and within existing authority. Verify the target if deployment runs. If deployment is unavailable or needs additional authority, report `landed; deployment pending`, with the exact next action, rather than claiming deployment success. No implicit push, release, or publication.

Update the persistent report with the landed SHA and deployment outcome. Leave managed worktree cleanup to Forgerie; do not remove branches or worktrees manually. When all work settles, call `workflow_finish` with the actual outcome. A failed landing or required deployment is not a completed run. Do not leave a terminal no-change or failure run idle indefinitely.
