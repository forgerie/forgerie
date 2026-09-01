---
"forgerie": minor
---

Dictation now reports from inside the draft box it locks. The box draws the turn
as a waveform from the loudness the capture worklet already measures, counts the
speech it captured, and counts the wait once the audio is with the gateway, where
it also offers Cancel. A turn shorter than the transcription route's 100 ms
minimum is refused in the browser and named on screen instead of being sent to
collect an HTTP 400 that nothing displayed.
