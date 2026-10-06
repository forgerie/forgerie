# Context use

A 2px bar on the input bar's top edge shows how much of the model's context window the session uses. It runs between the rounded corners, over the border line, so it adds no row and no number.

- The fill comes from Pi's `contextUsage.percent` in the session status. It updates after each reply.
- The fill is the live blue. From 80% it turns to the full text color.
- Before the first reply, and after a compaction until the next reply, Pi has no reading. The bar is then hidden, not drawn empty.
- It is a `progressbar` named "Context used" with the percent as its value, so a screen reader can read it. The title shows the percent to a mouse.

The user chose a bar on the composer over a number in the model row (2026-10-05). The composer was preferred to the header because the bar measures the model named in the same box.

## Limits

- 80% is a fixed guess. Pi compacts on its own a little before 100%: at the window size minus `compaction.reserveTokens`, which is 16,384 tokens in the current Pi settings. That is about 92% of a 200k window and 98% of a 1M window. The status does not send the reserve, so the bar cannot mark the real point.
- The bar lags by one reply. A large tool output can raise use a lot between two readings.
- On a touch screen the exact percent is not readable; the bar is the whole readout.

## Verification

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and all tests pass. Tests cover reading and rounding the percent, the unknown cases, a malformed reading that leaves the rest of the status intact (4), and the bar on the input's edge, its high mark, and its absence before a reading (3). |
| Real session | Session `01a0d563…` reported 14.9%. The bar filled about a seventh of the edge at all four Fold postures, in both color schemes. The model row shows no number. |
| Physical Fold | Not tested. |
