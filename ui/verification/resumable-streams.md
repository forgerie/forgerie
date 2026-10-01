# Resumable streams with Pi

The assistant-ui client resumes a Pi run after reload, a connection loss, or opening another tab. Sessiond owns the run. A browser subscribes to it without starting another model request.

This uses the behavior described in the [assistant-ui resumable-streams guide](https://www.assistant-ui.com/docs/guides/resumable-streams). It does not use the guide's AI SDK transport or byte-storage implementation. `ExternalStoreRuntime` consumes the reconciled Pi transcript instead.

## Ownership and join contract

| Guide concept | Forgerie implementation |
| --- | --- |
| Server-owned producer | Sessiond owns the Pi agent run. Closing a browser reader does not abort it. |
| Resume identity | The selected Pi session ID in `?session=` identifies the conversation. Reads carry its `cwd`. No global pending-stream storage can attach the wrong session. |
| Persisted output | `/messages` returns persisted Pi messages, including completed tools and reasoning. |
| Current partial | `/stream-snapshot` returns the current assistant message and a sequence watermark. |
| Run state | `/status` reports streaming, compaction, shell activity, and pending asks. |
| Live continuation | Subscribe to `/events` before reading authoritative state. Buffer events during the reads and reconcile before showing Ready. |
| Finalization | `message.end` settles the message. `agent.end` settles the run. An offline completion is recovered from history/status. |

Sequence numbers are watermarks, not replay cursors. The server has no missed-frame replay endpoint. A new join never reuses the previous join's sequence number. The browser never retries a mutating POST automatically.

The snapshot contains assistant content, not tool execution progress or results. Covered assistant deltas are omitted because their content is already in the partial. Covered tool events are reconciled too, because a tool can finish after the history read but before the snapshot. Persisted history results take precedence over older buffered tool output. Once the joined run is idle, unfinished tools become interrupted.

## Limits and cost

- Every recovery fetches full history. Large sessions have no paging or virtualization in this client.
- This is transcript recovery, not byte-for-byte replay. Tool progress produced entirely while disconnected is not recoverable from the assistant snapshot. Its final persisted result is recoverable when the tool ends.
- An active run survives browser closure and reload. A sessiond restart kills active runs. No model request resumes across daemon or host failure.
- Drafts survive connection recovery while the runtime stays mounted. This change does not persist drafts through a full page reload.
- Forgerie relies on Tailscale access, not application authentication. A session ID is an identifier, not a credential.

## Repeat the checks

Run automated checks in the app directory:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
```

Run the real browser check with this app available on 8510:

```sh
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/resume-acceptance.mjs
```

Set `APP_URL` to test another port. Set `FORGERIE_ROOT` if the app does not sit two directories below the main checkout. The script uses the shared posture CDP harness, not raw Chromium window sizes.

The live check creates one scratch session and sends one model prompt. A local Nix-shebang producer keeps its bash tool alive while the browser reloads and another tab attaches. The script verifies one producer invocation, one persisted user prompt, one tool result, and no browser mutations. It archives the scratch session and removes temporary files afterward. A failed attempt can require another model prompt.

Results and screenshots stay in ignored `verification/local/resume/`. Physical Fold sleep/wake, keyboard, and touch behavior remain unverified.
