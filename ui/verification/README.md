# Verification and limits

## Automatic reconnect

Checked on 2026-09-29. The standalone client on 8510 uses the unchanged Forgerie backend on 8504. No prompt was sent and no production service was restarted.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 58 tests passed. Recovery tests use a real HTTP/WebSocket server. They cover socket and HTTP failures, completion offline, tools and thinking, join buffering, a sequence reset, superseded responses, permanent failures, disposal, and prompt non-retry. |
| Real browser recovery. | `scripts/reconnect-acceptance.mjs` took Chromium offline at each of the four Fold postures. It observed 16 socket attempts and 5 history fetches. The first recovery used the timer alone. Later recoveries used the online signal. Every recovery retained the draft, transcript, and open disclosure. Scroll position remained at 80 CSS pixels. No API mutation or uncaught exception occurred. |
| Real history, read-only. | `scripts/real-trace-check.mjs` matched 13 API tool calls with 13 rendered tool lines, including 1 failure. All 8 thinking parts appeared. No page overflow or exceptions occurred. |
| Fixture checks. | `scripts/visual-acceptance.mjs` passed in both themes, including the new reconnecting and reconnecting-running states. Send and Stop remain disabled during recovery. The fixture made no API requests. |
| Visual review. | All eight reconnecting screenshots in `verification/local/reconnect-shots/` were captured with the main posture script and read. The notice stayed readable and the composer remained inside the viewport. The layout does not change between postures. |

Recovery behavior:

- Unexpected close, socket error, connection timeout, network read failure, and HTTP 5xx trigger automatic retry. Delays start at 500 ms, grow by 1.6, and stop growing at 5 s. Only a complete successful join resets the delay.
- Returning to a visible page, an online event, or a BFCache restore starts a fresh subscription. This also recovers a half-open socket that never reported a close.
- Each connection subscribes before fetching history, stream snapshot, and status. It buffers events during those reads and reconciles them with the snapshot watermark. A new connection never reuses the previous connection's sequence number.
- Forgerie's server does not replay missed frames by cursor. Recovery refetches authoritative state. Persisted message identities survive the reload so existing disclosures do not remount. Unfinished partials can be replaced by authoritative content.
- The thread/runtime stays mounted. The composer retains its draft, but input, Send, and Stop remain disabled until the join succeeds. assistant-ui's `isDisabled` alone did not disable Send in a regression test, so command buttons now explicitly respect it and the binding also sets `isSendDisabled`.
- Invalid consumed event data, malformed successful responses, missing sessions, and HTTP 4xx other than 408/429 stop automatic retry. The error and Reload action remain visible. Prompt and abort requests are never retried automatically because an acknowledgement can be lost after the server accepts a command.

The cost is a full history fetch on every restored connection and every return to the page. Large sessions still have no paging or virtualization. Timers run only when the browser schedules them. These checks use Chromium network and posture emulation, not physical sleep/wake or the Fold's keyboard.

The [Podia disconnected conversation](https://mobbin.com/screens/469ef97c-ed6f-463a-b2df-f3777866bb3e) informed the retained transcript plus one connection notice. This revision reuses the existing notice and header rather than adding a blocking dialog or changing the homepage-derived styling.

Repeat the read-only browser check from this worktree:

```sh
SESSION_ID=<existing-idle-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/reconnect-acceptance.mjs
```

Evidence stays in ignored `verification/local/reconnect-acceptance.json` and `verification/local/reconnect-shots/`. For the main posture script, set `CHROME_BIN` to the Chromium executable if its login-shell discovery cannot see the Nix shell's PATH.

## Tools and reasoning

Checked on 2026-09-29 against Forgerie on port 8504. No prompt was sent for this step.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 44 tests passed. Reducer tests cover history, both tool-event orders, late updates, unknown results, interrupted runs, and join-time partials with tools and thinking. UI tests cover joining, disclosures, failures, stopped calls, groups, and the working line. |
| Real history, read-only. | `scripts/real-trace-check.mjs` on session `01a0ef0c…` found 12 tool calls in the API and 12 tool lines on screen. The one failed result showed as `failed`. All 8 thinking parts rendered. No exceptions and no page overflow. |
| Real live run, read-only. | `scripts/live-trace-watch.mjs` watched a running session for 75 s while it ran tools. It received `tool.start` 5, `tool.update` 9, `tool.end` 4, `assistant.thinking.delta` 13, and `message.end` 7. At the end, 118 tool lines matched 118 API tool calls, and the 1 open line matched the 1 API call without a result. |
| Existing acceptance. | `scripts/acceptance.mjs` passed read-only on `01a0ef0c…`: history matched the API, reload did not duplicate, and the draft survived all four postures. |
| Fixture postures. | `scripts/trace-acceptance.mjs` opened reasoning, groups, a failed card, and the last card in 16 captures (2 scenarios × 2 themes × 4 postures). No page overflow, no summary overflow, all output inside the column, and every trace line at least 32 CSS pixels tall. The closed-state captures from `scripts/capture-postures.mjs` were also read. |

The first visual review found two defects. A failed call inside a closed group was invisible, so group lines now count failures and turn red. A `working` line also sat under a running tool, so it now shows only when no tool is running.

Design notes:

- A run's adjacent Pi assistant messages join into one reply through assistant-ui's `concat-content` join. The reply has one copy action, which copies text parts only.
- Tool results attach to their call in the reducer, not through assistant-ui's tool messages. One call id owns one state: `pending`, `running`, `done`, or `interrupted`. This ports the rule from Forgerie commit `1f391cd4`.
- A running tool passes its partial output as a preliminary result. A stopped call gets an empty settled result, so assistant-ui never reads it as awaiting action.
- Trace lines are 32 CSS pixels tall, not 44. This keeps a long run compact and exceeds the 24-pixel WCAG 2.2 AA minimum. It is a judgement, not a measured device result.
- Tool output renders only while its card is open and stops at 16,000 characters, with a count of the characters not shown.

## Homepage UI adaptation

Checked on 2026-09-29. The UI adapts the actual assistant-ui homepage sources at `dabe34fca8a31bf7f8afac89827bf3bf683942e6`, not a new visual design made from unstyled primitives. See [source mapping and licenses](../THIRD_PARTY_NOTICES.md).

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, ESLint, and 26 tests passed. The typecheck includes the fixture entry point. |
| Real history. | The existing session loaded three text messages. The last assistant reply matched the API after Markdown rendering. Reload did not duplicate messages. This revision sent no real prompts. |
| Fold transitions. | The real-session check kept an unsent draft through all four postures. Send remained inside the viewport with a 44 × 44 CSS-pixel hit area. |
| Visual review. | All eight final fixture PNGs in `verification/local/homepage-final/` were captured with the posture script and read back. Both themes retain the same reading column, user bubbles, code sheets, tables, and composer. No page overflow or hidden composer was seen. |
| Additional sizes. | Fixture checks passed at 475 × 280 for reduced-height emulation and 280 × 500 for a narrow pane, in both themes. This is not a physical keyboard test. |
| Presentation behavior. | Real browser clicks and Enter sent through the fixture runtime. Stop, empty, loading, and disconnected states passed. The preview made no API calls. |
| Long content. | Long URLs did not widen the page. Wide code and tables scrolled within their own keyboard-focusable regions. |
| Markdown and clipboard. | Component tests cover formatted replies, streamed updates, safe code highlighting, unknown code languages, image links without remote media loads, and copy success/failure for responses and code. |
| Dependencies. | `npm audit` reported zero vulnerabilities. |

The first visual pass exposed default paragraph margins inside user bubbles. Removing those margins restored the homepage's bubble density. The initial read-only acceptance rerun exposed a verifier race: it counted an older render captured before assistant-ui finished installing history. The verifier now waits for rendered history and uses that current render for the count.

The UI and code formatting increase the production JavaScript from about 632 kB to 980 kB, or from 190 kB to 300 kB after gzip. Vite still reports a bundle-size warning. Font files are served locally. The running app remains the managed Vite server on `[::]:8510`; Forgerie's production services stay unchanged.

## Initial MVP acceptance evidence

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

The app owns one session store. Transport effects live in `src/sessionStore.ts`. The pure reducer and message conversion live in `src/transcript.ts`. `src/useThreadMessages.ts` joins a run's messages for assistant-ui. `src/ForgerieSession.tsx` binds that state to assistant-ui. `src/ui/Thread.tsx` composes assistant-ui primitives without reading the Forgerie API.

## UI choices

The supplied homepage design replaces the original Verdana/slate presentation. Public Sans carries the chat text. JetBrains Mono carries code. The palette, 42rem column, right-aligned user bubbles, unboxed replies, bordered composer, and code sheets come from the homepage source. Radius tokens distinguish the thread, controls, and code sheets. Position and shape distinguish user and assistant messages without repeated role labels. Accessible labels retain each message's role.

The [ChatGPT reference](https://mobbin.com/screens/fa707eb9-8ecd-48e1-b94d-647c03a08bc6) also informed the readable reply column and persistent composer. The homepage source determines the visual treatment. A sidebar is not part of this single-session slice.

Gutters and message spacing follow the container. The same layout holds across all postures without device-width breakpoints. The composer is sticky inside the thread's viewport, matching the homepage structure. Code and tables have local scroll regions rather than widening the conversation.

Open `http://127.0.0.1:8510/verification/preview.html` for the separate dev-only fixture entry point. It imports the shipped presentation and uses an in-memory runtime without a network data source. Its scenarios are `history`, `empty`, `loading`, `running`, `disconnected`, `reconnecting`, `reconnecting-running`, `stress`, `tools`, and `tools-running`, selected with `?scenario=<name>`. This HTML entry point is not included in the production build.

From the worktree, run the browser fixture checks with:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/visual-acceptance.mjs
```

Tool and reasoning checks. None of them sends a prompt:

```sh
# Opens disclosures in the fixture at every posture and theme, checks layout, saves screenshots.
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/trace-acceptance.mjs
# Compares tool lines, failures, and reasoning with a real session's API history.
SESSION_ID=<existing-id> nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/real-trace-check.mjs
# Samples a session while it runs tools, then compares open and total tool lines with the API.
SESSION_ID=<running-id> WATCH_SECONDS=75 nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/live-trace-watch.mjs
```

Set `CHROME_BIN` if `chromium` is not on `PATH` inside the shell. All three write to ignored `verification/local/`.

Use the existing posture capture command with the fixture URL for reproducible, non-private visual content. Real-session screenshots and API content remain in ignored local evidence.

## Known limits

This is a private standalone MVP on an orphan branch, not a production client replacement. It does not ship in Forgerie's npm package, so no Forgerie Changeset was added.

Text, thinking, and tool calls are converted. Thinking shows as collapsed reasoning. Every tool uses one generic card with its input and text output; there are no custom `edit` diff or `bash` cards yet. Image parts in tool output show as `[image]`. Shell (`!` command) events and skill-read lines are not shown. Assistant text supports Markdown headings, lists, links, tables, and code fences. User messages retain their literal text. Markdown images become links, not remote media requests. Math and diagrams remain text. Ask forms, dialogs, and process cards are excluded. System messages render in full, including very long system prompts. A session waiting for an excluded form can stay Running until answered in the original Forgerie UI.

A closed socket triggers automatic reconnect and authoritative resync. The transcript and draft remain in memory, but commands and input stay disabled during recovery. Permanent contract/session failures still require Reload. There is no queue, branch switching, or persisted draft across page reloads. Rotation and reconnect preserve the current draft because they do not remount the app. Physical sleep/wake and keyboard behavior remain unverified.

History loads as one full response. There is no paging or virtualization yet. The production JavaScript bundle is about 998 kB before gzip and 306 kB after gzip. Vite reports its size warning. Stop's HTTP body is tested against the transport contract, but a real model run was not interrupted during acceptance.
