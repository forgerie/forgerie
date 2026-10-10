# ZAO speech inventory and adoption choices

## Recommendation

Keep ZAO's existing whisper.cpp service for recorded speech-to-text. Evaluate a shared Kokoro-FastAPI service for streaming text-to-speech. Adapt application speech clients rather than rewriting application features or speech models.

The earlier [API comparison](speech-api-compatibility.md) covered Forgerie and its prototype. This wider investigation found an already running system STT service and two more consumers of private speech workers. OpenAI compatibility is a practical HTTP/event contract here, not an IETF or W3C certification.

This is a recommendation, not approval to migrate. Tracking: [issue #30](https://github.com/forgerie/forgerie/issues/30).

## Scope and confidence

Verified on host `zao`: systemd service definitions, executable wrappers, installed Comics Kokoro worker, installed Assistant Foundation JavaScript, and two synthetic-audio requests to the active system dictation endpoint. Repository source supplied the remaining application details. No service was restarted or reconfigured.

The source checkout for this note started at Forgerie commit `457fd2b5`. Other application repositories were read, not edited. The current Comics Rust source contains progressive MP3 delivery, but the installed Rust executable's stream behavior was not exercised. Android code was inspected, not tested on a watch. No latency or broad vendor-API conformance is claimed.

The search covered active user and system services, application source for Forgerie, Comics, Assistant/Foundation, Storybook, Coach, Knowledge, Ossicle, Meetings, Synth, and related local projects. It is not an exhaustive search of all files on ZAO. No matching speech implementation was found in the checked Coach, Knowledge, Meetings, or Synth source. Ossicle consumes Comics narration through a same-origin proxy; it does not host another synthesis engine. Storybook's installed web assets did not contain the checked speech API/engine identifiers.

## Implementation distance

Effort labels describe scope, not elapsed time estimates. **Small** means request mapping and validation without changing inference. **Medium** changes worker output or the application adapter. **Large** adds live recognition, session lifecycle, media transport, and interruption behavior.

| Implementation | What exists | Distance to OpenAI Audio HTTP | Distance to live Realtime behavior |
|---|---|---|---|
| System `dictation-backend.service` | whisper.cpp 1.8.3, CUDA, a configured model, and `POST /v1/audio/transcriptions` on loopback port 8178. | Small remaining compatibility work. A multipart file/model/language/JSON request worked against the live server. Model validation and unsupported options need an explicit supported profile. | Large. This is file inference, not incremental microphone transcription or a WebRTC session. |
| Forgerie production STT | Raw float32 PCM upload to `/api/speech/transcribe`; private Whisper worker. | Small-to-medium adapter change. Convert recorded PCM to a supported file and call the shared STT endpoint. Preserve request limits, deadlines, and app errors. | Large. Current capture and inference produce a final clip transcript. |
| Forgerie voice prototype | Private STT, Smart Turn, and whole-WAV Kokoro routes. | Small for batch request mapping. Medium for genuine audio streaming, codec encoding, and cancellation. | Large. Smart Turn is useful engine code but does not supply the Realtime session/event/media implementation. |
| Comics / Reader / Ossicle | Reader proxy depends on Comics. Ossicle calls Comics narration through a same-origin bridge. Comics launches a CUDA Kokoro worker, caches validated sentence clips, and has app-specific narration RPC. Current Rust source progressively encodes completed clips as MP3; Ossicle's proxy buffers response bodies. | Medium to replace only Comics' synthesis adapter with `/v1/audio/speech`. Reader and Ossicle can keep their narration API. Preserve sentence positions, caches, and read-along features. | Large and mostly unnecessary for book narration. Progressive delivery of sentence clips is not incremental synthesis within a sentence. Ossicle's proxy also needs a streaming path if incremental delivery is required. |
| Assistant Foundation | Installed service uses private Forgerie Whisper and Comics Kokoro protocols. `/voice` sends custom control messages and PCM16. STT runs after `UtteranceEnd`; output sends each complete synthesized sentence. | Small-to-medium to change `Transcriber` and `Synthesizer` adapters for batch STT/TTS. Streaming needs interface changes. | Large. `Hush` discards stale turns but does not cancel active worker inference. PCM framing, push-to-talk, cards, and assistant state are app protocol concerns. |

### The active system STT endpoint is already close

The service command sets `--inference-path /v1/audio/transcriptions`. Its `/health` response was `{"status":"ok"}`.

A locally generated WAV containing "This is a speech compatibility test." produced:

| Multipart model value | HTTP result | JSON body |
|---|---|---|
| `whisper-1` | 200 | `{"text":" This is a speech compatibility test.\n"}` |
| `nonexistent-compatibility-probe-model` | 200 | The same transcript. |

The test verifies the basic multipart request and JSON response, not model selection. The server uses its configured model and accepted both names. A shared adapter must document supported aliases or reject unknown models. A compatible URL alone is not full API conformance.

Do not replace this working CUDA runtime merely to change the request contract. The least disruptive next step is to test the exact client options each app needs and add only the missing validation, decoding, error mapping, or model discovery.

### Private worker boundaries are the duplicated part

The installed Comics worker uses `kokoro-worker-v1`. It collects all Kokoro pipeline chunks, concatenates them, and writes a 24 kHz mono PCM16 WAV. The installed Assistant Foundation adapter waits for that file and decodes it before sending audio. Forgerie's prototype has the same whole-output pattern.

This is useful model integration, but it lacks the parts a reusable network TTS service needs: concurrent clients, incremental output, encoding, disconnect cancellation, and a public contract. Packaging Kokoro once does not make separate worker processes a shared service.

Reader and Ossicle are not separate Kokoro engines. `reader-proxy.service` depends on `comics.service`. Ossicle's `books.rs` forwards requests to Comics, and `useBookNarration.ts` requests sentence windows through that bridge. Its proxy buffers the upstream audio body, so adopting a streaming TTS server alone does not make that path incremental.

## Rewrite, wrap, or adopt

| Choice | When it makes sense | Cost and limitation |
|---|---|---|
| Keep whisper.cpp and adapt clients | Recorded dictation, voice notes, and push-to-talk final transcripts. | Lowest migration scope. Sharing one backend introduces queue contention and one common failure point. It does not provide live partial recognition. |
| Add OpenAI HTTP around the current Kokoro worker | Only a small, fixed batch TTS profile is needed, and pinned CUDA behavior matters more than multiple formats or streaming. | A reasonable small wrapper. Streaming and cancellation turn it into a service project this codebase must maintain. |
| Adopt Kokoro-FastAPI | Many apps need standard TTS requests, streaming output, voice options, or compressed formats. | Best TTS evaluation candidate. Test pinned models/voices, text normalization, codec behavior, cleanup, and request fairness. Existing cache identities must change if engine output changes. |
| Adopt Speaches for both engines | One server is worth changing the STT runtime and inference engine choices. | More integration surface can be supplied upstream, but it replaces working whisper.cpp integration. Its checked Realtime cancel handler is unimplemented and its STT transcribes after commit. It does not solve the watch requirements as inspected. |
| Implement a full OpenAI Realtime service | A live duplex contract is essential and no tested server covers the required subset. | Large ongoing compatibility obligation. VAD, partial transcript semantics, buffering, playback state, codecs, cancellation, and reconnects remain real work. Do not attempt it merely to claim standard compliance. |
| Adopt Wyoming or MRCPv2 | Home Assistant or SIP/telephony integration becomes a real consumer requirement. | Their ecosystem fit can justify them then. Today they add bridging or protocol costs without removing the watch's missing runtime behavior. |

### Kokoro-FastAPI packaging already exists, but it is not proof of a deployment

Mountainous contains a `kokoro-fastapi` Nix derivation labelled `0.3.0`, pinned to source `311ee6497b05dc904e505ba302048d08ba70c2ba`. That revision's router implements `/audio/speech`, format selection including Opus, speed and voice handling, and streamed output. It checks client disconnection between generated chunks.

That is stronger evidence than the current README alone. It still does not prove immediate interruption of an in-progress inference chunk, GPU resource release, or watch playback latency. Its error response wraps error information in FastAPI `detail`, which also prevents a blanket claim of exact OpenAI error conformance.

No active `kokoro-fastapi` service appeared in the checked system/user service inventory. Comics uses its private worker instead. Treat the derivation as packaging to evaluate or update, not an already proven shared TTS service. Its wrapper binds `0.0.0.0:8880`; a deployment needs loopback/tailnet exposure controls before use.

## Adapt the applications at the speech boundary

| Consumer | Change | Preserve |
|---|---|---|
| Forgerie dictation | Replace the internal worker-backed request path with a shared file-STT client. A same-origin app route can remain as a compatibility adapter. | Microphone capture, UI state, request limits, deadlines, and user error handling. |
| Comics / Reader / Ossicle | Replace Comics' worker command exchange with a TTS HTTP client. Retrieve WAV/PCM for cached sentence artifacts. Update the existing model/voice descriptor and cache identity for the selected backend. Keep consumer APIs unchanged for batch narration. | Book extraction, sentence positions, manifests, cache integrity, read-along, and progressive playback. These are app features, not generic speech API responsibilities. |
| Assistant | Replace `WhisperTranscriber` and `KokoroSynthesizer` internals. Add cancellable streaming interfaces only when required. | Agent execution, sentence splitting, cards, device lifecycle, and permissions. Do not force assistant cards or app state into OpenAI speech events. |
| Voice prototype | Use it as a test client for the chosen speech service instead of retaining another production worker host. | Useful interaction experiments and Smart Turn comparisons, not its copied server implementation by default. |

A standard speech API does not require every application API to become standard. The shared service accepts audio/text and returns transcripts/audio. Application APIs still handle books, agents, sessions, and decisions.

## Interruption remains an application concern too

Assistant's Android `Speaker.kt` queues `Hush` on the same thread that performs blocking `AudioTrack.write` calls. Clearing queued commands does not interrupt the current sentence write. This can delay local playback interruption. This is a source-level finding, not a measured device failure.

A new backend alone cannot meet the sub-200 ms target. Test local acoustic onset to the last audible sample separately from server cancellation and resource release. Server-side `Hush` only marks a turn stale; it does not abort the current STT/TTS worker request.

## Suggested migration order

1. Verify and document the existing STT server's small HTTP profile. Adapt one recorded-STT consumer first, with rollback to its current worker.
2. Run a pinned Kokoro-FastAPI candidate on an isolated loopback port. Test streamed bytes, voice parity, interruption, resource release, and two simultaneous clients.
3. Adapt one TTS consumer. Preserve cached narration semantics and keep background book synthesis from blocking interactive speech.
4. Consolidate proven consumers. Keep the live watch pipeline as a separate acceptance task covering recognition, turn detection, Opus, echo, and interruption.

This order delivers shared batch speech without pretending the full watch pipeline is solved. The downside is temporary duplicate runtimes during validation and the risk of shared-service contention after migration.

## Sources

- System service: `/etc/systemd/system/dictation-backend.service`; implementation configuration: `/home/simonwjackson/code/github/simonwjackson/mountainous/features/dictation-backend/nixos.nix` and `default.nix`.
- Active endpoint: `http://127.0.0.1:8178/health` and `/v1/audio/transcriptions`. Only synthetic test speech was submitted.
- Comics launch wrapper: `/home/simonwjackson/.nix-profile/bin/comics-server`. Installed worker: `/nix/store/yw2iq7d0a9cdjx8j8hxcjmbd9v4xz2s3-kokoro_worker.py`.
- Comics source: `/home/simonwjackson/code/sandbox/comics/services/comics/src/narration/coordinator.rs`, `identity.rs`, `cache.rs`, and `../api.rs`. Source was inspected; the installed Rust stream path was not exercised.
- Reader service: `/home/simonwjackson/.nix-profile/share/systemd/user/reader-proxy.service`. Ossicle source: `/home/simonwjackson/code/sandbox/ossicle/services/ossicle/src/books.rs` and `clients/player/src/Books/useBookNarration.ts`.
- Installed Assistant code: `/nix/store/iayjk1ggcmrxr4awgm5s0z5jlzp900rp-pi-assistant-foundation-0.1.0/lib/pi-assistant-foundation/dist/speech-workers.js` and `voice-link.js`.
- Assistant source: `/home/simonwjackson/code/sandbox/assistant-foundation/src/speech-workers.ts`, `voice-link.ts`, `voice-protocol.ts`, and `android/app/src/main/kotlin/com/simonwjackson/assistantvoice/Speaker.kt`.
- Existing TTS packaging: `/home/simonwjackson/code/github/simonwjackson/mountainous/packages/kokoro-fastapi/default.nix`; [pinned upstream router](https://github.com/remsky/Kokoro-FastAPI/blob/311ee6497b05dc904e505ba302048d08ba70c2ba/api/src/routers/openai_compatible.py).
- Forgerie code and protocol sources: [speech API comparison](speech-api-compatibility.md). Speaches evidence there remains an untested candidate comparison, not a live deployment claim.
