# Verification and limits

## Acceptance evidence

Checked on 2026-09-29 against the existing Forgerie server on port 8504. The test selected existing session `01a0ef0c-343b-70d6-902d-d26b3d5b1af9`. It did not create a session or change its model.

| Check | Result |
| --- | --- |
| Initial history. | Five text messages appeared before the successful send. |
| Real prompt. | The browser sent exactly one `{ cwd, text: "hello" }` request during the successful run. |
| Streaming. | The browser received 22 `assistant.delta` frames and showed partial text while Running. |
| Completion. | One user message and one assistant reply appeared. Reload showed seven text messages without duplicates. |
| Browser errors. | No uncaught JavaScript exceptions appeared in the successful run. |
| Automated checks. | Build, TypeScript, ESLint, and 14 tests passed. Tests use a real HTTP/WebSocket server with binary frames. |
| Dependencies. | `npm audit` reported zero vulnerabilities after updating Vitest. |
| Fold transitions. | An unsent draft survived all four emulated postures. Send remained inside the viewport with a 48 CSS-pixel height. |
| Visual review. | All eight light/dark posture PNGs were captured with `scripts/capture-postures.mjs` and read back. No horizontal clipping or hidden composer was seen. |

Two real `hello` prompts were sent in total. The first exposed binary frames forwarded by Forgerie's proxy. The browser originally received a Blob, and JSON parsing failed. Setting `binaryType = "arraybuffer"` and using `TextDecoder` fixed it without async event reordering. The second acceptance run passed. Binary-frame behavior is now covered by the transport test.

A later read-only check loaded three visible text messages and matched the last assistant reply exactly to the API. The source session's returned history changed after the send tests. Its cause was not investigated. This MVP has no branch picker. An initial verifier incorrectly assumed the final visible message was an assistant reply. It now compares the last assistant message, including when history ends with a user message.

Local evidence stays in ignored `verification/local/hello.json`, `verification/local/history.json`, and `verification/local/shots/`. It contains real session content and must not be committed. Managed process `aui-mvp-dev` runs the standalone Vite client. No production service was restarted.

## Repeat acceptance

From this worktree, with Forgerie and the MVP dev server running:

```sh
# Read-only history, reload, and posture-transition checks.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/acceptance.mjs

# Adds a real hello prompt to the selected session and consumes model usage.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/acceptance.mjs --send
```

Choose an idle session without an open ask form or dialog. The script expects existing text history and a text reply. Its CDP helpers come from the main Forgerie checkout. `FORGERIE_ROOT` overrides that location if the worktree moves. `APP_URL` overrides the default `http://127.0.0.1:8510/`.

From the main Forgerie checkout, capture each color scheme separately:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/capture-postures.mjs \
  --url 'http://127.0.0.1:8510/?session=<existing-id>' \
  --out .worktree/new-ui-mvp/verification/local/shots \
  --label dark --color-scheme dark
```

Repeat with `--label light --color-scheme light`. Read all eight images. The measured CSS viewports are 704 × 783, 932 × 553, 475 × 638, and 711 × 374. These checks use headless device emulation, not the physical Fold or its keyboard. No physical-device acceptance is claimed.

## Contract references

All paths refer to the main Forgerie checkout at `a348db81`.

- `src/server/sessions/sessionRoutes.ts:595-621` requires `cwd` for history/status/snapshot query parameters and prompt/abort JSON bodies. A live history request without `cwd` returned HTTP 400. Prompt returns `{ accepted: true }`, not the model reply.
- `sessionRoutes.ts:549-553` subscribes to events using only the session ID.
- `src/server/sessiond/sessionProxyRoutes.ts` exposes browser routes under `/api` and bridges the socket. Vite preserves this prefix.
- `src/shared/apiTypes.ts:1368-1388` defines history pages and the in-flight stream snapshot. Events carry sequence numbers for join-time reconciliation.
- `src/server/sessions/piSessionService.ts:5630-5675` maps Pi stream events to text deltas and completed messages.

The app owns one session store. Transport effects live in `src/sessionStore.ts`. The pure reducer and text conversion live in `src/transcript.ts`. `src/ForgerieSession.tsx` binds that state to assistant-ui. `src/ui/Thread.tsx` composes assistant-ui primitives without reading the Forgerie API.

## UI choices

The conversation follows [ChatGPT's readable reply column and persistent composer](https://mobbin.com/screens/fa707eb9-8ecd-48e1-b94d-647c03a08bc6). It omits the reference's sidebar, avatars, and menus because this slice has one session and text-only actions.

The typeface is Verdana with DejaVu Sans fallback. The light tokens use slate ink `#203249`, canvas `#f3f6fa`, paper `#ffffff`, blue action `#294c80`, user text area `#e6edf7`, and rule `#c7d2df`. Dark tokens preserve the same roles. Role labels distinguish messages without relying on color. The column width is capped, spacing follows the container, and the composer keeps its actions inline without device-width breakpoints. The transcript scrolls independently of the composer.

## Known limits

This is a private standalone MVP on an orphan branch, not a production client replacement. It does not ship in Forgerie's npm package, so no Forgerie Changeset was added.

Only text is rendered. Markdown markers remain literal. Tools, thinking, images, ask forms, dialogs, and process cards are excluded. A session waiting for an excluded form can stay Running until answered in the original Forgerie UI.

A closed socket disables sending and asks for a manual reload. There is no automatic reconnect, queue, branch switching, or persisted draft across reloads. Rotation preserves the current draft because it does not remount the app. Initial snapshot reconciliation is covered by tests, but complete reconnect/replay parity is not claimed.

History loads as one full response. There is no paging or virtualization yet. The production JavaScript bundle is about 632 kB before gzip and 190 kB after gzip. Vite reports its size warning. Stop's HTTP body is tested against the transport contract, but a real model run was not interrupted during acceptance.
