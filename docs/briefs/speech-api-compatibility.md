# Shared speech service: API compatibility research

## Finding

Neither speech implementation currently exposes a standard or an OpenAI-compatible API. Both use app-specific HTTP routes and private worker protocols.

**Recommendation, not an approved decision:** use the OpenAI Audio HTTP contract for file STT and text-to-speech, plus its Realtime transcription contract for live input. Prefer WebRTC with negotiated Opus for the watch's live microphone. Keep agent execution and narration outside the speech service.

This is a commonly adopted vendor contract, not an IETF or W3C speech-service standard. It avoids inventing another app API, but it does not remove the work required for streaming engines, cancellation, WebRTC, and echo handling. The checked self-hosted candidates do not establish that the watch requirements are already satisfied.

Research scope: repository source at `3f651f1a`, primary protocol documents, and selected candidate-server source. No running service was exercised or restarted. No latency, watch compatibility, or third-party conformance was measured. Tracking: [issue #30](https://github.com/forgerie/forgerie/issues/30).

## What the workspace actually implements

| Capability | Forgerie production path | Voice-content prototype |
|---|---|---|
| HTTP STT | `POST /api/speech/transcribe`; raw float32 little-endian PCM, 16 kHz mono; JSON `{text}`. | `POST /api/stt`; the same raw PCM input; final JSON transcript. |
| HTTP TTS | None. | `POST /api/tts`; JSON `{text, voice}`; complete 24 kHz mono PCM16 WAV. |
| Live STT | None. Capture finishes before the transcription request. | None. Microphone batches remain client-side until the utterance is finalized. |
| Turn detection | Service reports `smartTurn: unavailable` and `capability: manual-only` when Whisper is ready. | `/api/check-turn` calls Smart Turn v3.2 on up to the last eight seconds of audio. The client proposes a pause after 650 ms of silence. |
| Streaming synthesis | None. | None. Kokoro chunks are collected and concatenated, written to a file, then read in full before HTTP delivery. The client waits for `arrayBuffer()` and decodes the whole response. |
| Cancellation | Queued jobs can be removed. Active callers can stop waiting, but the worker continues until completion or timeout; its queue slot remains occupied. | Client fetch abort and playback stop exist. Server worker inference does not receive a cancellation signal. |
| Opus | None in the inspected path. | None in the inspected path. |

Evidence: [routes](../../src/server/speech/speechRoutes.ts), [service and admission queue](../../src/server/speech/speechService.ts), [Whisper process](../../src/server/speech/whisperProcess.ts), [dictation adapter](../../ui/src/speech/ForgerieDictationAdapter.ts), [prototype server](../../prototypes/voice-content/server.py), [runtime](../../prototypes/voice-content/voice_runtime.py), [Kokoro worker](../../prototypes/voice-content/workers/kokoro_worker.py), [Smart Turn worker](../../prototypes/voice-content/workers/smart_turn_worker.py), [microphone](../../prototypes/voice-content/web/mic.js), [HTTP client](../../prototypes/voice-content/web/api.js), and [playback](../../prototypes/voice-content/web/voice.js).

Private protocols are `forgerie-whisper-worker-v1`, `forgerie-smart-turn-worker-v2`, and `kokoro-worker-v1`. Persistent workers reduce repeated startup; they do not make inference streaming. The prototype's scripted agent and rule-based narration also do not demonstrate live coding-agent integration.

### The current interruption path misses the intended budget on paper

The prototype requires four 50 ms voiced batches before it calls the speech-start handler. Playback then fades for 60 ms and schedules source stop 10 ms later. That gives a nominal code budget of about **270 ms**, before device audio buffering. This is an inference from constants, not measured acoustic latency.

Local playback interruption, cancelling server generation, and deciding whether a user has finished a turn are three different operations. A fast interruption must not wait for remote STT or the Smart Turn pause check. The prototype README also records speaker-induced false interruptions; echo handling must be tested on the actual watch.

## Existing specifications and contracts

| Candidate | What it standardizes | Fit and cost |
|---|---|---|
| **OpenAI Audio HTTP** | Vendor contract: multipart `/v1/audio/transcriptions`, JSON `/v1/audio/speech`, transcript responses, audio formats, streamed output. Adopted by self-hosted implementations. [1–3, 9–10] | Best baseline for app and SDK reuse. File-transcription streaming means results for an uploaded recording, not a continuous live microphone. HTTP alone has no speech-specific cancellation acknowledgement. |
| **OpenAI Realtime** | Vendor session/event contract over WebSocket or WebRTC: audio input, transcript events, VAD, response cancellation, and playback/history controls. [4–6] | Suitable reference for live input. Full response/conversation semantics are much larger than a speech-only service. Compatibility must name a version and a supported subset. |
| **Wyoming** | Open protocol used by Home Assistant: discovery, TCP JSONL framing, PCM audio start/chunk/stop, transcribe/transcript, synthesize, streamed text synthesis, and VAD events. [7] | Direct fit for modular local workers. The published audio framing is PCM, with no negotiated Opus profile or explicit synthesis-cancel event in the checked event catalogue. Browser access needs a bridge. Encryption and authentication are deliberately outside the protocol. |
| **MRCPv2, RFC 6787** | IETF Standards Track speech-resource control: recognition, synthesis, STOP, START-OF-INPUT, and BARGE-IN-OCCURRED. Session setup uses SIP/SDP; media is separate. [8] | The strongest formal STT/TTS control standard here. UniMRCP/FreeSWITCH integrations show telephony use. A SIP/media stack and browser/watch bridge add cost without a current telephony requirement. It does not guarantee a 200 ms result. |
| **WebRTC and Opus** | Media transport, negotiation, security, and codecs. WebRTC endpoints must implement Opus and G.711. [11] | Good live-audio transport; it does not define transcription or synthesis requests. Negotiated support does not prove Opus is actually selected. |
| **SSML 1.1** | W3C speech markup for pronunciation, rate, pauses, and related output controls. [12] | Useful optional synthesis input, not a network service API. Current Kokoro request handling does not establish SSML support. |
| **Web Speech API** | Browser JavaScript recognition and synthesis interfaces. The specification explicitly excludes the underlying transport protocol. [13] | Not a contract for a shared server. It cannot establish the watch WebView's capabilities or control over a chosen remote engine. |

OpenAI Realtime WebSocket audio is **not Opus** in the checked schema: PCM is 16-bit, 24 kHz mono; the other formats are G.711 μ-law and A-law. WebRTC media negotiation is separate. OpenAI HTTP TTS can return Opus, but container decoding and buffering still need client validation. [2, 4–6]

VAD detects speech and silence; semantic turn detection estimates whether the speaker has finished. Implementing Smart Turn does not reproduce OpenAI's semantic model merely because both can feed similar events. Some model/session combinations restrict VAD, so declare and test the supported configuration. [5–6]

## Adapter work versus runtime work

| Target | Straightforward mapping from current code | Missing behavior that needs more than an adapter |
|---|---|---|
| OpenAI file STT | Accept multipart `file` and `model`; decode audio to the worker's 16 kHz format; return JSON `{text}`. | Supported file formats, language/model options, error shape, and optional timestamp/logprob fields need explicit contracts. Do not silently accept options the worker ignores. |
| OpenAI HTTP TTS | Map `input` to `text`; expose real Kokoro model/voice names; return WAV when requested. | Incremental worker output, streaming HTTP delivery and playback, Opus encoding, disconnect-to-inference cancellation, and supported speed/options. The present `voice` field is optional; OpenAI's is required. |
| Realtime transcription | Reuse final Whisper inference and Smart Turn internally after decoding and resampling. | Session state, continuous input, event correlation, VAD/commit rules, backpressure, and reconnect policy. Meaningful partial transcripts require an incremental recognition strategy; emitting a final string in a delta-shaped event is not proof of live partial recognition. |
| Full Realtime audio responses | Existing text and voice requests provide some engine primitives. | Conversation/response lifecycle, actual output deltas, cancellation acknowledgements, playback clearing, and heard-versus-generated history. Do not present this as a drop-in TTS wrapper. |

For OpenAI conversational Realtime, `response.cancel` leads to a cancelled `response.done`. WebRTC/SIP also have `output_audio_buffer.clear`. A WebSocket client must stop and discard its own queued playback, and truncate unheard assistant audio with `conversation.item.truncate` when applicable. Cancellation does not retract samples already queued on the device. These are conversational response controls, not commands for cancelling an HTTP `/audio/speech` request. [6]

## Evaluate an existing server before writing a replacement

| Candidate | Evidence checked | Recommendation and remaining risk |
|---|---|---|
| **Speaches** | Documentation describes an OpenAI-compatible WebSocket API and warns that `response.cancel` and `conversation.item.truncate` are unsupported. The inspected cancel handler returns a not-implemented error. STT accumulates a buffer and transcribes after commit; it emits a completed transcript, not pre-commit partials. HTTP TTS uses `StreamingResponse` and an audio encoder. [9] | Evaluate its HTTP STT/TTS to reduce protocol work. Its inspected Realtime path does not meet the watch's cancellation or incremental transcript requirements. WebRTC/Opus is not established by the checked docs. Engine/runtime changes and protocol-version differences also need evaluation. |
| **Kokoro-FastAPI** | README advertises OpenAI-compatible `/v1/audio/speech`, streamed PCM, and encoded formats including Opus. [10] | Useful TTS evaluation candidate, not an STT/turn-detection solution. Watch decoding, true first-audio latency, and disconnect cancellation were not measured. It also adds a separate runtime to operate. |
| **Wrap current workers** | The local workers and Forgerie's queue/deadline/process boundaries are visible in source. | Preserves pinned engines and controls, but leaves this project responsible for streaming, WebRTC, encoding, cancellation, and conformance. Choose this only if candidate-server gaps outweigh that maintenance cost. |

The recommendation is to evaluate, not install or switch. No candidate is verified as a complete replacement. Speaches documentation references beta-era session fields and `OpenAI-Beta: realtime=v1`; the current OpenAI reference uses a different session schema. Do not equate the compatibility label with current full API conformance.

## Proposed shared-service boundary

Expose one service to multiple apps, with two established APIs:

1. OpenAI Audio HTTP for recorded STT and app-authored spoken text. Stream TTS bytes as synthesis produces them. Use Opus where the client can decode it incrementally; keep PCM/WAV for validation and compatible clients.
2. OpenAI Realtime **transcription mode** for the live microphone, with a documented session schema and event subset. Use WebRTC/Opus for constrained-device input if compact live audio is required. WebSocket PCM is a useful test path, not an equivalent bandwidth solution.

Keep the coding agent, permissions, decisions, and narration selection in the consuming app. The speech service transcribes and speaks; it need not become another autonomous agent. Apps may submit successive narration phrases as HTTP TTS requests; audio streaming is not the same as accepting a live stream of text in one request.

**Cost:** two transports and client-side audio lifecycle code, plus unresolved WebRTC, cancellation, and live-partial-transcript requirements in the checked Speaches path. HTTP disconnect cancellation needs an implementation-level guarantee and tests; it has no OpenAI speech-event acknowledgement. If one duplex session with explicit synthesis cancellation is mandatory, this narrower profile is insufficient: evaluate a full conversational Realtime implementation or MRCPv2 rather than quietly inventing new events.

A shared service also needs per-client queue limits and fair scheduling. Preserve Forgerie's admission limits, deadlines, bounded payloads, and process recovery. Same-origin guards cannot simply be removed to serve unrelated browser apps; define permitted origins and tailnet access explicitly. Restarting a shared worker to cancel one client can disrupt other clients.

## Approval-gated validation experiment

Use a separate test endpoint and pinned candidate versions. Do not replace production first.

| Check | Evidence required before choosing an implementation |
|---|---|
| Contract reuse | Two independent clients use the same base URL, documented model/voice IDs, and standard requests. Verify multipart STT, streamed TTS, and honest rejection of unsupported options. |
| Real streaming | Log microphone arrival, pre-end-of-turn transcript events if promised, end-of-turn detection, final transcript, first synthesized sample, and first audible playback. Test long utterances. |
| Interruption | Measure user acoustic onset to last audible TTS sample on the actual watch. Report p50/p95 against the approximately 200 ms target. Separately log server cancellation, resource release, and acceptance of the next request. Test with loudspeaker echo. |
| Compact media | Inspect negotiated codec/SDP and captured network bytes. Verify Opus decoding, container support, loss/jitter behavior, and tailnet transitions; do not infer radio savings from codec names. |
| Shared use | Run two apps concurrently; cancel one without stopping the other. Exercise queue saturation, deadlines, stale audio rejection, and worker failure. |
| Android shell | Verify microphone permission, audio focus, mute/stop, native/WebView handoff, reconnect, and screen-off/background behavior on the full-Android watch. |

No service choice or implementation is approved by this report.

## Primary sources

1. [OpenAI transcription request reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create.md).
2. [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech.md).
3. [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text.md).
4. [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).
5. [OpenAI VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad.md).
6. [OpenAI Realtime event/schema reference](https://developers.openai.com/api/reference/resources/realtime.md) and [conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations.md).
7. [Wyoming protocol and event catalogue](https://github.com/OHF-Voice/wyoming/blob/08a0c258df83fea6e1643bcfe67e86243f01cf31/README.md) and [Home Assistant integration](https://www.home-assistant.io/integrations/wyoming/).
8. [RFC 6787: MRCPv2](https://www.rfc-editor.org/rfc/rfc6787.html), especially §§3–4, 8.4.2, 8.7–8.8 and 9; [Microsoft UniMRCP speech plugins](https://github.com/Azure-Samples/Cognitive-Speech-TTS/blob/master/MRCP/README.md).
9. [Speaches Realtime compatibility](https://speaches.ai/usage/realtime-api/). Source at `993994f7984bf3fe9655b267448328cf66fccb42`: [response cancellation](https://github.com/speaches-ai/speaches/blob/993994f7984bf3fe9655b267448328cf66fccb42/src/speaches/realtime/response_event_router.py), [VAD and commit](https://github.com/speaches-ai/speaches/blob/993994f7984bf3fe9655b267448328cf66fccb42/src/speaches/realtime/input_audio_buffer_event_router.py), [transcription buffering](https://github.com/speaches-ai/speaches/blob/993994f7984bf3fe9655b267448328cf66fccb42/src/speaches/realtime/input_audio_buffer.py), and [speech delivery](https://github.com/speaches-ai/speaches/blob/993994f7984bf3fe9655b267448328cf66fccb42/src/speaches/routers/speech.py).
10. [Kokoro-FastAPI README](https://github.com/remsky/Kokoro-FastAPI/blob/c9cfeb262817bf3aabdf2cda3d3f892d82f222b0/README.md). This is development-branch documentation, not verification of a released image.
11. [RFC 7874: WebRTC audio requirements](https://www.rfc-editor.org/rfc/rfc7874.html), §3.
12. [W3C SSML 1.1](https://www.w3.org/TR/speech-synthesis11/).
13. [Web Speech API](https://webaudio.github.io/web-speech-api/), introduction and API definitions.

External links describe the versions read during this investigation, not a tested deployment. Unpinned upstream source can change; pin versions before the validation experiment.
