---
date: 2026-08-13
topic: composer-live-dictation
---

# Composer Live Dictation

## Summary

Add one microphone control to the message composer. A short press captures a hands-free turn that Smart Turn can complete automatically; a held press keeps listening until release. Local Whisper then inserts an editable, unsent transcription into the draft.

---

## Problem Frame

Forgerie is used as a touch-first installed PWA on a Galaxy Fold. Writing a substantial Pi prompt currently requires the Android keyboard, which consumes much of the chat area and interrupts reading the transcript.

The existing live-dictation implementation uses browser Web Speech. That gives live interim text, but it delegates audio processing and lifecycle behavior to a browser provider. The desired product direction is a Forgerie-owned speech capability that can support larger voice features later without expanding this first user-facing slice beyond the composer.

---

## Actors

- A1. Forgerie user: Speaks, reviews, edits, and sends a Pi prompt.
- A2. Message composer: Owns the microphone interaction, draft insertion point, and visible speech state.
- A3. Forgerie speech pipeline: Captures microphone audio, determines turn completion, and transcribes the completed turn with local models.

---

## Key Flows

- F1. Tap for automatic turn completion
  - **Trigger:** A1 gives the composer microphone a short press.
  - **Actors:** A1, A2, A3
  - **Steps:** Capture starts from the current composer selection without opening the keyboard. Releasing the short press leaves capture active. Smart Turn evaluates pauses and ends the turn only when the speech sounds complete. Whisper transcribes the completed audio, and A2 inserts the result into the draft.
  - **Outcome:** A1 receives editable, unsent draft text without manually ending the turn.
  - **Covered by:** R1-R3, R5-R8, R11-R13

- F2. Hold for an explicitly bounded turn
  - **Trigger:** A1 presses and holds the composer microphone.
  - **Actors:** A1, A2, A3
  - **Steps:** Capture starts on press. Once the press becomes a hold, Smart Turn cannot end the turn while the button remains held. A1 may pause for any length supported by the capture limit. Release ends the turn, Whisper transcribes the captured audio, and A2 inserts the result into the draft.
  - **Outcome:** A1 controls the full capture boundary and can speak through pauses without automatic completion.
  - **Covered by:** R1, R2, R4-R8, R11-R13

- F3. Stop, fail, or leave safely
  - **Trigger:** A1 manually stops tap-mode capture, changes session or new-session destination, leaves the composer surface, or a speech dependency fails.
  - **Actors:** A1, A2, A3
  - **Steps:** A manual stop completes and transcribes the current turn. An ownership change aborts the unfinished turn. A failure releases the microphone and reports a recoverable state. Existing and previously finalized draft text remains unchanged in every case.
  - **Outcome:** Speech cannot cross session boundaries, send a prompt, or damage an existing draft.
  - **Covered by:** R8-R10, R14-R16

---

## Requirements

**Composer interaction**

- R1. The message composer provides one microphone control. This release does not add speech input to other Forgerie fields.
- R2. Microphone capture starts on the initial press, without focusing the editor or opening the Android keyboard. A short press and a held press use the same control.
- R3. Releasing a short press leaves hands-free capture active. Smart Turn may complete that turn automatically after speech has started and a pause is judged complete.
- R4. Holding the control keeps capture active until release. Smart Turn completion results must not end capture while the control remains held.
- R5. Releasing a held press ends the turn and starts transcription. While hands-free capture is active, pressing the microphone again manually ends the turn and starts transcription.
- R6. Speech starts at the current composer selection. A successful transcription replaces selected text or inserts at the current cursor when the selection is empty.
- R7. The microphone control shows unambiguous capture, completion-check, transcription, and error states without adding persistent status text to the composer rail. It does not promise live word-by-word interim text.
- R8. Dictation always produces an editable draft. It never sends, queues, or steers a prompt automatically and never reopens the keyboard after microphone completion.

**Turn completion and transcription**

- R9. Smart Turn answers only whether a spoken turn sounds complete. It does not classify semantic intent, route voice commands, or alter the transcribed words.
- R10. Tap mode continues listening after an incomplete Smart Turn result. A detector failure leaves manual completion available instead of silently discarding the turn.
- R11. Forgerie uses its own local Whisper service for transcription and does not depend on browser Web Speech recognition.
- R12. Whisper receives the complete bounded turn after automatic completion, manual completion, or held-button release. A successful result is inserted once, in order, without duplicate text.
- R13. Capture and transcription have explicit finite limits. Reaching a limit completes the current turn visibly rather than allowing unbounded browser memory, request size, or server work.

**Draft integrity, privacy, and failure**

- R14. Changing the selected session or new-session destination, leaving the current composer surface, disconnecting, or closing the page aborts unfinished capture. Late detector or transcription results cannot change another draft.
- R15. Permission denial, unavailable microphone hardware, detector failure, transcription failure, timeout, and empty speech each release resources and produce a clear state without changing existing draft text.
- R16. Forgerie transports microphone audio to its own server only for turn detection and transcription. It does not store raw microphone audio as durable application data. Finalized text follows the existing active-session or new-session draft behavior.

**Target-device experience**

- R17. The microphone control and all speech states fit the intrinsic composer layout without crowding existing actions.
- R18. Capture state and draft ownership remain correct through all four Galaxy Fold postures and foreground fold or rotation transitions. Completion requires validation in the installed PWA on the physical device.

---

## Acceptance Examples

- AE1. **Covers R2-R5.** Given an idle composer, when A1 presses and releases the microphone quickly, capture starts on press and remains active after release until Smart Turn completes the spoken turn or A1 presses the microphone again.
- AE2. **Covers R3, R9, R10.** Given tap-mode capture and a pause in an unfinished sentence, when Smart Turn reports incomplete, Forgerie keeps listening without another press.
- AE3. **Covers R4, R5.** Given a held microphone and a long pause, when Smart Turn reports complete before A1 releases, capture continues; when A1 releases, Forgerie ends and transcribes the full held turn once.
- AE4. **Covers R6-R8, R12.** Given selected draft text, when a turn transcribes successfully, the transcription replaces that selection as editable text, remains unsent, and does not open the keyboard.
- AE5. **Covers R10, R15.** Given tap-mode capture with usable audio, when Smart Turn is unavailable, Forgerie explains that automatic completion is unavailable and lets A1 press the microphone to complete the turn manually.
- AE6. **Covers R14-R16.** Given active capture in session A or the new-session composer, when A1 changes to another session or destination, Forgerie releases the microphone, discards the unfinished audio, preserves the existing draft, and ignores late results.
- AE7. **Covers R13.** Given capture that reaches its finite limit, Forgerie visibly completes the bounded turn and transcribes it instead of continuing to accumulate audio.
- AE8. **Covers R17-R18.** Given the installed PWA on the physical Fold, A1 can start tap mode, hold mode, and manual completion in all four supported postures and across foreground posture transitions without control overlap or cross-session draft changes.

---

## Success Criteria

- A1 can dictate a prompt from the composer without opening the Android keyboard, then review, edit, and explicitly send the resulting draft.
- Tap mode ends a naturally completed turn without another action, while hold mode never ends before release because of a pause or Smart Turn result.
- Forgerie owns the speech path through local Whisper and Smart Turn without retaining raw audio as durable data.
- Existing drafts and finalized speech survive failures, session changes, and Fold posture changes without speech crossing ownership boundaries.
- Physical-device acceptance confirms both gestures and microphone cleanup across all four Galaxy Fold postures.

---

## Scope Boundaries

- No speech input outside the message composer.
- No automatic prompt submission.
- No semantic intent detection, voice commands, spoken composer actions, or command routing.
- No live word-by-word interim transcription requirement.
- No browser Web Speech provider or second selectable transcription provider.
- No durable raw-audio recording, playback, or transcript history separate from the existing draft and session transcript.
- No app-wide public speech API in this release. The internal boundary must remain reusable, but future consumers are deferred.
- No offline or phone-only transcription requirement.

---

## Key Decisions

- One dual-gesture microphone: A short press gives hands-free automatic completion; a held press gives an explicit release boundary without adding a second control.
- Smart Turn controls endpointing only: It answers whether the user has finished speaking and never interprets what the user means.
- Local Whisper replaces browser Web Speech: Forgerie owns transcription behavior and creates one foundation for later voice features, at the cost of server CPU, memory, model startup, and audio transport.
- Completed-turn text instead of interim text: The first local pipeline inserts one transcription after endpointing rather than maintaining a second provisional text lifecycle.
- Draft-first completion: Speech remains ordinary editable composer input and never becomes an implicit send action.
- Reusable internals, narrow product surface: The speech boundary may support larger future plans, but only the composer exposes it now.

---

## Dependencies / Assumptions

- The installed PWA runs in a secure HTTPS context and receives microphone permission.
- The Forgerie host can run the selected local Whisper and Smart Turn models with acceptable warm latency and concurrent resource use.
- The browser can stream or upload bounded microphone audio to the Forgerie server over the existing private tailnet deployment.
- Exact press-duration, pause, audio-size, and timeout limits require measurement on the physical Galaxy Fold during planning and implementation.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2-R5][Needs research] Measure a hold threshold that distinguishes a quick press from an intentional hold without delaying capture or causing accidental mode changes on the Fold.
- [Affects R3, R10, R13][Needs research] Set pause, detector window, capture duration, and failure fallback limits from the proven comics prototype and physical-device measurements.
- [Affects R11-R16][Technical] Define the Forgerie-owned service lifecycle, readiness, bounded audio contract, cancellation behavior, and deployment wiring for Whisper and Smart Turn.
