# Composer dictation input probe notes

## Purpose

This disposable prototype supports U10 for the local Whisper/Smart Turn composer dictation plan. It proves the browser-side gesture, permission, and lifecycle facts before production controller work.

## How to run

```bash
cd /home/simonwjackson/code/sandbox/forgerie/.worktrees/feat/local-composer-dictation
node prototypes/serve.mjs prototypes/composer-dictation-input 8600
```

Open `http://127.0.0.1:8600/` locally, or expose the same static server on a trusted same-origin tailnet URL for the physical Fold.

## Implemented probe behavior

- One compact microphone control in a Forgerie-style composer action rail.
- Native `navigator.mediaDevices.getUserMedia()` permission request starts from `pointerdown` or Space keydown.
- Pointer capture is used for the press gesture.
- The hold threshold is centralized in the prototype as `HOLD_THRESHOLD_MS = 450` and logged when crossed.
- Release and cancel are latched while permission or device acquisition is pending.
- If release happens before readiness, a later successful microphone acquisition enters auto-listening.
- If the pointer or Space key is still held when readiness arrives and the threshold elapsed, the probe enters held-listening.
- Pointer cancel, lost pointer capture, hidden visibility, `pagehide`, and `freeze` stop microphone tracks fail-closed.
- Space keydown starts/holds, Space keyup releases, Enter or Space completes auto/manual-only listening, repeated keydown is ignored, and Escape aborts.
- AudioContext sample rate/state and sanitized audio-track settings are displayed.
- Track `readyState`, `enabled`, `muted`, channel count, sample rate, echo cancellation, noise suppression, and auto gain are displayed when available.
- Logs are metadata-only. They do not include samples, device labels, device IDs, group IDs, transcripts, or network payloads.
- No Smart Turn, Whisper, model, fetch, WebSocket, storage, IndexedDB, localStorage, file, or audio recording path exists in the prototype.

## Facts recorded in code, not yet physical evidence

- The prototype's starting hold threshold is 450 ms.
- The prototype records actual press duration per gesture in the metadata log.
- The prototype records the actual `AudioContext.sampleRate` and sanitized `MediaStreamTrack.getSettings()` values after microphone permission succeeds.
- The prototype records lifecycle events: visibility changes, page hide, freeze, resize, orientation change, focus, and blur.

## Physical Fold facts pending

These facts must be measured on the Samsung Galaxy Fold before U4/U6/U7 treat them as production constants:

- Whether 450 ms feels correct for short-press versus hold.
- Whether Android Chrome emits `visibilitychange`, `pagehide`, or `freeze` during foreground fold/unfold and rotation.
- Whether home, lock, screen off, and app switch stop tracks promptly.
- Whether permission-prompt focus changes produce pointercancel or only delayed acquisition.
- Whether the microphone control avoids opening the keyboard in the installed PWA.
- The actual `AudioContext.sampleRate` and track settings on the physical Fold.
- Whether all four physical postures keep one action rail with no wrapping or overlap during live capture.

## Headless viewport evidence

Captured and inspected on 2026-08-14 with Chromium headless from `http://127.0.0.1:44831/`:

| Viewport | Screenshot | Inspection result |
|---|---|---|
| 704 × 783 | `/tmp/forgerie-u10-shots/704x783.png` | One composer island, one rail, microphone visible, no rail wrap. Lower metrics scroll below the fold. |
| 932 × 553 | `/tmp/forgerie-u10-shots/932x553.png` | One centered composer island, one rail, microphone visible, no rail wrap. Metrics start below the first fold. |
| 475 × 638 | `/tmp/forgerie-u10-shots/475x638.png` | One composer island, one rail, microphone visible, no rail wrap. Status text truncates rather than adding a second rail row. |
| 711 × 374 | `/tmp/forgerie-u10-shots/711x374.png` | One composer island, one rail, microphone visible, no rail wrap. Privacy/help content scrolls below the short viewport. |

This is layout evidence only. Headless Chromium cannot prove microphone permission UI, Android keyboard behavior, physical Fold lifecycle events, or track cleanup.

## Manual physical checklist

Use synthetic/non-sensitive speech only. Do not save recordings.

1. First permission prompt:
   - press and release before permission is granted;
   - hold through permission grant;
   - cancel before permission resolves;
   - deny permission.
2. Pointer behavior:
   - short press enters auto-listening;
   - hold crosses threshold and waits for release;
   - slide off/on while pointer capture is active;
   - context menu does not appear during capture;
   - second press completes auto/manual listening.
3. Keyboard behavior:
   - Space starts and holds;
   - Space release completes held mode or enters auto after short release;
   - Enter or Space completes auto/manual listening;
   - repeated keydown is ignored;
   - Escape aborts and releases tracks.
4. Lifecycle privacy:
   - home;
   - lock/screen off;
   - app switch;
   - fold/unfold;
   - rotate through all four postures.
5. Cleanup:
   - browser microphone indicator turns off after completion, abort, denial, and lifecycle loss;
   - metadata log contains no audio sample data or device IDs.
