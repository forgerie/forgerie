---
title: "feat: Collapse delegated forks in the session inbox"
type: feat
status: completed
date: 2026-08-10
verify_command: "npm run verify"
---

# feat: Collapse delegated forks in the session inbox

## Summary

Make `parentSession` mean delegation by clearing it when the user forks by hand,
then collapse every remaining child under its parent in the inbox board — reusing
the `forkGroupedRows()` machinery that `SessionList` already uses. Children whose
parent file has been deleted collapse under an explicit placeholder row rather
than falling back to being roots.

---

## Problem Frame

The inbox carries 99 rows with the same title. They are fork-context children
that `pi-subagents` creates for delegated agents, and they grow at roughly 65 a
day. Measured on 2026-08-10: 2290 sessions, 1670 with a parent, 102 distinct
parents referenced, of which only **10 still exist on disk**.

Two facts, established by inspecting the real files, constrain every option:

1. **A delegated child does not know it is one.** Its header is
   `type, version, id, timestamp, cwd, parentSession` — the same shape a manual
   fork produces. `PI_SUBAGENT_RUN_ID` and the child boundary instructions are
   injected into the runtime prompt and never persisted. Checked across whole
   files, not just headers.
2. **The parent that did know is usually gone.** The parent of the 99 rows is
   deleted; only its run directory survives.

So delegation cannot be derived after the fact. Rather than infer ownership,
this plan makes the user declare it: a manual fork becomes parentless at
creation, so anything still carrying `parentSession` is machine-delegated.

---

## Requirements

- R1. A session forked by hand is parentless and appears as a top-level inbox row.
- R2. A session that still carries `parentSession` is treated as a delegated child and does not occupy its own top-level inbox row.
- R3. Children collapse under their parent row, which carries the count.
- R4. Children whose parent file no longer exists collapse under an explicit placeholder row rather than becoming roots.
- R5. A collapsed parent row reports only its own unread count.
- R6. No new persistent store is introduced; all grouping derives from session file headers already read by the catalog.
- R7. The board's four state groups (Blocked on you / Working / Unread / Open) continue to work, and the inbox remains usable at all four Fold postures.

---

## Scope Boundaries

- No deletion of session files. The 99 files remain on disk and in the catalog; this plan changes what the inbox shows, not what exists.
- No change to `pi-subagents`. It is third-party and not a Forgerie dependency.
- No "promote to its own session" action. The user forks only from a main session, and U1 makes those parentless at birth, so there is nothing to promote.
- No agent counts, chips, or badges on inbox rows.
- No change to the Agents panel shipped in `01KZMSMT9AH8A352RP58BY4H9C`.

### Deferred to Follow-Up Work

- Retroactive detach for manual forks created **before** U1 lands: they still carry `parentSession` and will collapse under their parent. Decide after living with the change for a few days.
- Catalog cost of 2290 sessions: owned by `work/items/active/01KZMKYX9G4THPDDE08FYVF8GE-session-catalog-performance`.

---

## Context & Research

### Relevant Code and Patterns

- `src/client/src/sessionForkGrouping.ts` — `forkGroupedRows()`, `descendantCounts()`, `sessionAncestorIds()`. Already solves this exact problem; its own doc comment describes it. Operates on pre-order rows carrying `{ id, depth }`.
- `src/client/src/components/SessionList.ts` — the only current consumer, and the reference call shape.
- `src/client/src/sessionBoard.ts` — `SessionBoardSessionInput` (line 46) has no parent or depth field; `SessionBoardRow` (line 216) is `{ session, state, location }`. This is the gap U2 closes.
- `src/client/src/components/SessionInboxPanel.ts` — renders the board; does not group.
- `src/client/src/sessionTreeModel.ts:42` — "missing nodes become roots, and the edge that would close a cycle is detached". This is why orphans need U4 and do not come for free.
- `src/server/sessions/piSessionService.ts:2353` — `forkFromTree()`, the manual fork path U1 changes.
- `src/server/sessions/piSessionService.ts:4368` — `clearParentSession()`, and `4380` `clearParentSessionHeader()`. Rewrites the header in place, same inode. U1 reuses these rather than inventing a write path.
- `src/server/sessions/sessionFileHeader.ts:20` — already documents that `parentSession` is the one header field Forgerie may clear.

### Institutional Learnings

- The delegated-agents panel in `01KZMSMT9AH8A352RP58BY4H9C` proved that posture capture finds defects unit tests cannot: three real bugs (row overflow at 499px, a misleading `0 working`, counts that did not add up) survived 27 green tests. U5 budgets for the same discipline.

---

## Key Technical Decisions

- **Declare ownership, do not infer it.** Clearing `parentSession` on a manual fork is provenance stored with the artifact. Forgerie keeps no index, so nothing can drift; the TUI sees the same thing; deleting Forgerie leaves the change intact.
- **Group by lineage, because ownership is unrecoverable.** The delegated-agents plan separated lineage from ownership and used that to reject lineage grouping. Ownership is the better idea and is also underivable for existing data. Lineage is the only signal that survives, and U1 makes it mean what we need.
- **Orphans group by their recorded parent value, not by a parent row.** The parent path string is present on every child even when the file is gone, so it is a usable grouping key with no lookup.
- **Placeholder rows are explicit about what is missing.** The group header states that the parent session was deleted. Borrowing the first child's title would put "Investigate bug causal chain…" back on screen as the group name.
- **Unread stays own-only.** A parent reporting 99 unread relocates the noise rather than removing it.
- **State grouping is unaffected in practice.** A delegated child runs headless with no interactive user, so it cannot reach "Blocked on you"; the spawning agent handles its children. Cross-state conflict is therefore not a case this plan designs for. U3 asserts the degenerate case rather than building machinery for it.

---

## Open Questions

### Resolved During Planning

- Can a delegated child be recognised from its own file? — No. Verified across whole files: no `PI_SUBAGENT_*` value, no boundary text, header shape identical to a manual fork.
- Can it be recovered from the parent transcript? — Only for parents that still exist: 10 of 102. The 99 rows in question have a deleted parent.
- Should Forgerie maintain an index of delegated children? — No. Rejected as derived state that can drift from the transcript that produced it.
- Should this include a promote action? — No. U1 makes manual forks parentless at creation, so there is nothing to promote back out.

### Deferred to Implementation

- **Whether `forkGroupedRows()` can be used unchanged.** It expects pre-order rows with `depth`; the board produces a flat list per state group. U2 may need a small adapter rather than a signature change. Decide against the real types.
- **Where the placeholder row sorts** relative to real rows within a state group — by the newest child's `modified`, most likely, but confirm against `deriveSessionBoard`'s existing ordering rather than inventing a rule.
- **Whether detaching at fork time breaks any existing relationship view.** `withMachineSessionRelationships()` and the tree navigator both read parent links; U1 must check what a parentless fork does to those surfaces.

---

## Implementation Units

### U1. Make a manual fork parentless at creation

**Goal:** After a user forks by hand, the new session carries no `parentSession`, so `parentSession` becomes a reliable delegation marker going forward.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Modify: `src/server/sessions/piSessionService.ts` (`forkFromTree`, ~line 2353)
- Test: `src/server/sessions/piSessionService.forkFromTree.test.ts`

**Approach:**
- Reuse the existing `clearParentSession()` / `clearParentSessionHeader()` pair rather than writing a new header path; they already rewrite in place and preserve the inode, and `sessionSummaryScanner` is documented to tolerate exactly that rewrite.
- Clear after the fork is fully written, so a failure leaves an ordinary child rather than a half-detached file.

**Execution note:** Test-first. This mutates a user's session file, and the failure mode is silent data damage.

**Test scenarios:**
- Happy path: forking from a tree entry produces a session whose header has no `parentSession`.
- Happy path: the forked session's transcript content is unchanged by the clear — same message count, same first message.
- Edge case: forking a session that itself has no parent still succeeds.
- Error path: if the clear fails, the fork result still reports success and the child remains readable, rather than leaving a truncated header.
- Integration: a freshly forked session appears in the catalog as a root with no parent linkage.

**Verification:**
- A manual fork made through the UI shows as its own top-level inbox row.
- The session file's first line parses and lacks `parentSession`.

---

### U2. Carry parent linkage into the board's input

**Goal:** Give `sessionBoard.ts` the parent information it needs to group, without changing what it means for a row to be in a state group.

**Requirements:** R2, R6

**Dependencies:** U1

**Files:**
- Modify: `src/client/src/sessionBoard.ts` (`SessionBoardSessionInput`, `SessionBoardRow`)
- Modify: `src/client/src/components/SessionInboxPanel.ts` (pass the field through)
- Test: `src/client/src/sessionBoard.test.ts`

**Approach:**
- Add an optional `parentSessionPath` to `SessionBoardSessionInput`; it is already present on the API's session shape, so this is plumbing rather than new data.
- Keep `deriveSessionBoard` returning a flat row list. Grouping is a separate derivation in U3 so state classification stays independently testable.

**Test scenarios:**
- Happy path: a session with a parent keeps its existing state classification — adding the field changes nothing about which group it lands in.
- Edge case: a session with no `parentSessionPath` behaves exactly as before.
- Edge case: a session whose parent is itself in the list is not reordered by this unit.

**Verification:**
- Existing `sessionBoard` tests pass unchanged; the new field is additive.

---

### U3. Collapse children under a parent that is present

**Goal:** Within a state group, a parent row carries its children instead of the list repeating them.

**Requirements:** R3, R7

**Dependencies:** U2

**Files:**
- Create: `src/client/src/sessionBoardGrouping.ts`
- Modify: `src/client/src/components/SessionInboxPanel.ts`
- Test: `src/client/src/sessionBoardGrouping.test.ts`

**Approach:**
- Build pre-order `{ id, depth }` rows from the parent links, then delegate to `forkGroupedRows()`. Do not reimplement collapse, expansion, or descendant counting.
- Collapsed by default; the parent row shows the descendant count.
- Reuse `toggleExpandedSessionId()` for expansion state so the behaviour matches `SessionList`.

**Test scenarios:**
- Happy path: a parent with three children renders one row with a count of 3.
- Happy path: expanding the parent reveals the three children.
- Edge case: a parent with no children is not expandable and shows no count.
- Edge case: grandchildren nest under their own parent, and the top row counts all descendants.
- Edge case: a cycle in parent links does not hang or duplicate rows.
- Integration: a child in a different state group than its parent still appears exactly once overall. This is the degenerate case — a delegated child cannot block on the user — so the test asserts the invariant rather than a designed behaviour.

**Verification:**
- The inbox shows one row per delegated batch whose parent still exists.

---

### U4. Collapse orphans under an explicit placeholder

**Goal:** Children whose parent file has been deleted collapse together instead of becoming roots.

**Requirements:** R4

**Dependencies:** U3

**Files:**
- Modify: `src/client/src/sessionBoardGrouping.ts`
- Modify: `src/client/src/components/SessionInboxPanel.ts`
- Test: `src/client/src/sessionBoardGrouping.test.ts`

**Approach:**
- When a `parentSessionPath` names a session absent from the list, synthesise one placeholder node per distinct path and attach its children beneath it.
- Label it as a deleted session with the child count. Do not borrow a child's title.
- The placeholder is not selectable — there is no session to open.

**Test scenarios:**
- Happy path: 99 children sharing one missing parent path render as a single placeholder row counting 99.
- Happy path: two distinct missing parents produce two placeholder rows, not one merged group.
- Edge case: a single orphan still groups under a placeholder rather than appearing as a root.
- Edge case: clicking the placeholder does not attempt to open a session.
- Error path: a malformed or empty `parentSessionPath` is treated as no parent, and the session stays a root.

**Verification:**
- The live inbox shows one placeholder row where the 99 rows were.

---

### U5. Unread behaviour and posture validation

**Goal:** A collapsed row stays quiet, and the change holds at all four Fold postures.

**Requirements:** R5, R7

**Dependencies:** U4

**Files:**
- Modify: `src/client/src/components/SessionInboxPanel.ts`
- Test: `src/client/src/components/SessionInboxPanel.test.ts`

**Approach:**
- A collapsed parent or placeholder reports only its own unread count. Children's unread becomes visible on expansion.
- Capture the four postures with `scripts/capture-postures.mjs` against a running instance and read every image. Never `--window-size`.

**Execution note:** The delegated-agents panel proved unit tests do not catch row overflow or misleading counts. Budget for defects found here.

**Test scenarios:**
- Happy path: a parent with unread children shows only its own unread count while collapsed.
- Edge case: a placeholder row shows no unread count of its own.
- Edge case: expanding reveals each child's unread count unchanged.
- Integration: a long placeholder label does not push the count off a 499px row.

**Verification:**
- All four Fold postures captured and reviewed; rows stay one line; counts legible at 499px.

---

## System-Wide Impact

- **Interaction graph:** `withMachineSessionRelationships()` and `SessionTreeNavigator` also read parent links. A parentless manual fork changes what they show — U1 must check both.
- **State lifecycle risks:** `clearParentSession()` rewrites a header in place. A crash mid-write could truncate a session file. U1's test coverage is the mitigation, and the operation is already used in production for detach.
- **Unchanged invariants:** board state classification, the four state groups, the archive index, and the Agents panel are untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Clearing the header damages a session file | Reuse the existing detach path, already in production; test-first in U1; clear only after the fork is fully written |
| Manual forks made before U1 collapse under their parent | Named as deferred follow-up; visible immediately, reversible by detaching |
| `forkGroupedRows()` does not fit the board's flat rows | Adapter in U3 rather than changing a function `SessionList` depends on |
| Grouping hides something the user needed to see | Unread stays own-only but children remain one click away; posture validation in U5 |
| Placeholder rows proliferate if many parents are deleted | One row per distinct missing parent; 92 today, but almost all with a single child |

---

## Sources & References

- Backlog item: `01KZN1RQ4J9P0DK4TQ3CDFHE30`
- Sibling work: `work/items/active/01KZMSMT9AH8A352RP58BY4H9C-delegated-agents-panel/plan.md` (its `R9` is superseded by this plan)
- Related active work: `work/items/active/01KZMKYX9G4THPDDE08FYVF8GE-session-catalog-performance`
- Design artifact: the delegation wireframe, Panel A (inbox with delegated rows suppressed)
