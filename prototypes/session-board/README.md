# Session board — inbox prototype

A throwaway visual prototype of **concept 3: State Board**. Sessions become the
root list, grouped by *what they need from you* rather than *where they live*.

```bash
cd prototypes && node serve.mjs . 8600
# http://127.0.0.1:8600/session-board/
```

Capture the Fold 8 posture matrix:

```bash
cd prototypes && ./capture.sh session-board /tmp/board
```

## What it demonstrates

- **Session is the atomic unit.** One flat, global list. No machine → project →
  workspace drill-down.
- **Location is metadata, not navigation.** Every row carries a
  `project · branch` chip. The old hierarchy survives as the "Group by: Project"
  toggle — one view among several, not the only door.
- **Groups are states, not folders**: Blocked on you, Errored, Working, Unread,
  Open, Archived.
- **Archive is the primary verb.** Inline `Archive` per row, `Archive & next` in
  the thread, `E` on the keyboard, all with an undo toast. "Open" is the
  deliberate hang-around pile.
- **Triage order exists already** (`triageQueue()`), so concept 2's
  work-through-one-at-a-time mode can layer on top without a second model.

Keyboard: `J`/`K` move · `E` archive & advance · `G` group by · `A` archived ·
`Esc` back to the list.

## Files

| File | Graduates? | Purpose |
|---|---|---|
| `sessionBoard.js` | **yes** | Pure derivation: sessions + statuses + activities + unread → grouped board. No I/O, no DOM, no clock. Port to `src/client/src/sessionBoard.ts` with types and unit tests. |
| `fixtures.js` | no | Fixture world shaped like the real wire types. |
| `app.js` | no | Vanilla rendering and interaction. Composition only. |
| `styles.css` | partly | Token usage and the container-query morph are the reusable parts. |

## Grounding in the real data model

Nothing here needs new agent-side data. Every signal already exists:

| Board state | Derived from |
|---|---|
| Blocked on you | `SessionStatus.pendingAsk`, `SessionStatus.pendingDialogs` |
| Errored | `SessionActivity.phase === "error"` |
| Working | `isStreaming` / `isBashRunning` / `isCompacting`, `phase === "active"` |
| Unread | membership in `SessionUnreadCatalogSnapshot` |
| Open | none of the above, not archived |
| Archived | `SessionInfo.archived` / `archivedAt` |

Precedence is total and deliberate: `archived > blocked > errored > working >
unread > open`.

## What is faked

- **The transcript.** Fixture text. This prototype is about the list.
- **The global session store.** The real blocker. Today the client's session
  list is workspace-scoped and `resetWorkspaceScopedState()` clears it on every
  selection change, and the only listing API is `list(cwd)`. A real build needs
  either fan-out over known workspace cwds or a new machine-scoped endpoint.
- **Search.** Absent here and absent in the API. An inbox makes that gap more
  obvious, not less.
- **Snooze / hold.** `Hold` just advances. Real "hold until" needs new persisted
  state, which is why it is not in the state model.

## Layout notes

- The docked/overlay morph is a **container query** on the page frame, and its
  820px threshold is content-derived: it matches `NAVIGATION_DOCK_MIN_WIDTH`
  (260 + 560) in `src/client/src/appShell/shellLayoutMode.ts`. Of the four Fold 8
  postures only unfolded landscape (979px) docks; the rest overlay. Same
  paradigm either way — the list is always the list.
- `.pane-board` is its own container, so rows respond to the pane's width
  (~330px docked, full-width overlaid), not the viewport.
- No user-agent, touch, or device-model sniffing.

## Verified

- `npm run typecheck`, `npm run lint`, `npm run knip` all pass with this
  directory present — `prototypes/` is outside every tool's scope.
- All four postures captured and reviewed at true CSS viewports. `capture.sh`
  measures chromium's window-chrome offset via `probe.html` and compensates,
  because `--window-size` is the outer window (asking for 739 gives a 652px
  viewport) and would otherwise invalidate posture testing.
