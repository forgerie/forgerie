# Handoff navigation

A successful `handoff_session` or `spawn_session` call now shows an "Open session" button. The button opens the session that the call created. Before this change, the reply showed the call only as a collapsed tool line, and the destination session could be opened only from the picker.

This change stays on `new-ui-mvp`. It does not touch `main`, the Lit client, or the backend.

## Behavior

| Case | What the reply shows |
|---|---|
| Successful handoff or spawn | The call's tool line sits outside the collapsed activity, with an "Open session" button on the same row. |
| Destination in another workspace | The button reads "Open in" plus the workspace name. Its title gives the full path. |
| Failed call | No button. The call stays in the collapsed activity, and the activity counts it as failed. |
| Running call | No button until the result arrives. |

- The activity group does not count the promoted call. The tool line already reports it.
- Calls on both sides of a door keep their own groups. The order in the reply does not change.
- The tool line still opens. Its input (the focus or prompt) and its output stay one tap away.
- The button calls the same session switch as `/fork` and `/clone`. The URL changes to `?session=<id>`, the picker sheet closes, and browser Back returns to the source session.
- The door does not show the destination's state. The picker shows whether that session is preparing, working, or waiting.
- If the picker catalog knows the destination's title, the header shows it. Otherwise the header reads "Session".
- Layout: the line's text truncates first. The button is drawn 28 px tall, has a 44 px touch target, and is at most 12rem wide. The button wraps below the line only when the row cannot give the line 10rem. That does not happen at any Fold posture.

## Data path

- The server reports the destination in the tool result's `details`. A handoff gives `destinationSessionId` and `cwd`. A spawn gives `sessionId` and `cwd`.
- History: `toolResult` messages keep `details`. `src/contracts.ts` now parses it as an unknown value.
- Live: `tool.end` events carry `details`. The schema now keeps it.
- `handoffDoorOf` in `src/handoffDoor.ts` reads the destination with a Zod schema for each tool. Only successful calls count. The transcript keeps only `{ sessionId, cwd }`, not the whole `details` object.
- `convertMessage` puts the destination on the tool part's artifact. `src/ui/Messages.tsx` reads it there to keep the call out of the collapsed group.
- `SessionDoorsProvider` in `src/ui/SessionDoor.tsx` supplies the session switch and the current workspace from `ForgerieSession`.

## Checks

Checked on 2026-10-01.

| Check | Result |
|---|---|
| `npm run verify` | Build, TypeScript, ESLint, and 358 tests passed. New tests cover the destination parse for each tool, failed calls, malformed `details`, history parsed through the wire schema, live `tool.end`, reconnect without duplicates, and the rendered door in the real assistant-ui runtime. |
| `scripts/handoff-acceptance.mjs` | Passed all four Fold postures in both themes with real Chromium input. Both doors stay on their tool line and inside the column, each keeps a 44 px touch target, a pointer press and Enter each open the right session, an expanded call body stays inside the column, and the failed handoff stays counted. No API calls and no page exceptions. |
| `scripts/handoff-shots.sh` | Captured closed and expanded doors in 16 posture and theme combinations. All were reviewed. |
| `scripts/real-handoff-check.mjs` | Against session `01a0ef0c` on 8504: 19 of 19 successful handoff results rendered a door, none inside a collapsed group. The last door opened its destination with its catalog title, and Back returned to the source. No API writes and no page exceptions. |
| `scripts/trace-acceptance.mjs`, `scripts/visual-acceptance.mjs` | Passed with no regressions. |

## Limits

- Physical-device testing on the Fold remains unverified.
- A live handoff was not run. The live path is covered by unit tests and by reading `piSessionService.ts`, which puts `details` on `tool.end`.
- If the destination session was deleted, the door still shows. Opening a deleted destination was not tested. The session store will show its load error (inferred from `sessionStore.ts`).
- Switching sessions does not keep the source session's unsent draft. "Draft protection" is a separate parity item.
- The `/handoff` user message still shows the full skill text. "Skill presentation" is a separate parity item.
