# Dictation

The microphone button uses assistant-ui's `ComposerPrimitive.Dictate` and `StopDictation`. Speech goes to Forgerie's existing `/api/speech/transcribe` endpoint, not browser speech recognition or a cloud provider. Stop commits the transcript into the draft. Cancel discards it. Sending stays blocked until dictation ends. Chat and ask mode share the same controls and input.

## HTTPS on the Fold

Remote microphone access requires HTTPS. Plain HTTP works only on browser-trusted loopback addresses. For the server's Tailscale hostname, obtain a certificate outside the repository:

```sh
mkdir -p ~/.local/share/forgerie-aui-tls
tailscale cert --cert-file ~/.local/share/forgerie-aui-tls/zao.crt --key-file ~/.local/share/forgerie-aui-tls/zao.key zao.hummingbird-lake.ts.net
```

Start from this app directory:

```sh
FORGERIE_AUI_ALLOWED_HOSTS=zao.hummingbird-lake.ts.net \
FORGERIE_AUI_TLS_CERT=$HOME/.local/share/forgerie-aui-tls/zao.crt \
FORGERIE_AUI_TLS_KEY=$HOME/.local/share/forgerie-aui-tls/zao.key \
nix shell nixpkgs#nodejs_22 -c npm run dev
```

Open `https://zao.hummingbird-lake.ts.net:8510/`. Give the browser microphone permission. Certificates expire and need renewal through the same command. Restart Vite after renewal. Keys must stay outside Git. This remains a dev process, not a persistent systemd deployment.

The Vite proxy translates Origin and Host only for matching same-origin speech requests on an explicitly allowed app hostname. Loopback is allowed by default. Remote hosts need `FORGERIE_AUI_ALLOWED_HOSTS`. This prevents DNS-rebinding requests from using a matching attacker Origin and Host to acquire loopback trust. HTTPS HTTP/2 requests use `:authority` instead of Host; the proxy validates either form. It rejects ambiguous headers. Vite also uses this hostname allowlist. Backend allowlists and authentication policy do not change.

## Implementation boundaries

`ForgerieDictationAdapter` owns capture, transcription, cancellation, and visible failure state. `DictationProvider` binds that state to React. The SDK owns draft insertion. Changing the session, question, ask, or connection cancels capture and any pending transcription before another input owner receives text.

This standalone orphan app cannot import production files by ancestry. `src/speech/speechCapture.ts`, its worklet and tests, and shared policy/contracts are snapshots from Forgerie `main` at `0e183628`. Their imports are localized. `speechApi.ts` is the existing API client with relative `/api` URLs. This retains the proven flush, audio resampling, track release, validation, and timeout behavior. Cost: future changes to production speech code need deliberate review here. Do not create another capture implementation beside it.

Automatic turn detection remains disabled. Stop is explicit. Transcription uses mono 16 kHz little-endian Float32 PCM, not the guide's example WebM upload. The guide is https://www.assistant-ui.com/docs/guides/dictation.

The microphone sits in the existing action row, as in [ChatGPT's shipped composer](https://mobbin.com/screens/fc303bbc-5d5f-4ffc-b3ce-065abc9693bc). Styling uses the existing assistant-ui homepage tokens. Stop and Cancel have non-overlapping 44 px hit areas; status text truncates before controls do.

The change was rebased onto the MVP's concurrent slash-command, mention-discovery, and streamed-Markdown work. Their composer popovers, command-result handling, and resume behavior stay intact.

## Verification

Checked on 2026-09-30:

- `npm run verify` passes build, TypeScript, ESLint, and 250 tests. Tests exercise the real SDK controls, captured PCM, cancellation before startup and during transcription, late replies, backend refusal, permission failure, ask replacement, question changes, disconnection, and unmount. Overlong dictated ask answers stay editable and cannot be sent until shortened to 4,000 characters.
- `scripts/visual-acceptance.mjs` passes existing chat checks, including fold/rotation draft retention and narrow panes.
- `scripts/dictation-acceptance.mjs` passes four Fold viewports in both schemes for chat and ask dictation. Captures were reviewed in `verification/local/dictation/`. Controls remain reachable, the ask input remains singular, and the action row stays within the viewport. Hidden SDK textarea measurement nodes are excluded from the input count.
- Chromium's real `getUserMedia` and AudioWorklet captured a supplied speech WAV, sent PCM through Vite to the live Whisper endpoint, and inserted an editable final draft. No Pi prompt was sent. The direct PCM probe also returned HTTP 200. This is synthetic audio, not a physical microphone check. The same end-to-end check passed through valid Tailscale HTTPS at `https://zao.hummingbird-lake.ts.net:8525`, with no certificate bypass. HTTPS exposed the HTTP/2 `:authority` header difference; validating it fixed the original request refusal.
- The live backend reports `whisper: ready`, `capability: manual-only`. Untrusted short requests remain HTTP 403. A large denied upload can instead produce a Vite proxy HTTP 500 because the backend terminates its upload; it still fails closed. That existing proxy failure is not fixed here.
- No physical Fold was connected. `adb devices` returned an empty list. Physical microphone permission, keyboard, folding, and rotation remain unverified.

Repeat browser capture with a speech WAV:

```sh
DICTATION_WAV=/path/to/spoken-test.wav APP_URL=http://127.0.0.1:8510 \
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/dictation-acceptance.mjs
```

The WAV is a Chromium test input, not an upload format. The script never sends a Pi prompt. Without `DICTATION_WAV`, it checks only the network-free fixture and posture matrix.
