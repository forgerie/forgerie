# Context use

The input bar shows how much of the model's context window the session uses, as a whole percent, right after the model and thinking level. For example: `GPT 6.0 Sol High ⌄ 15%`.

- The number comes from Pi's `contextUsage.percent` in the session status. It updates after each reply.
- From 80% the number turns to the full text color and weight. Below that it stays muted.
- Before the first reply, and after a compaction until the next reply, Pi has no reading. The number is then hidden, not shown as 0%.
- A screen reader reads "15% of context used". It does not announce each change.
- The number is a readout, not a button. It never takes the model button's width, and it stays at every width.

The user chose a percent over an exact token count (2026-10-05).

## Limits

- 80% is a fixed guess. Pi compacts on its own a little before 100%: at the window size minus `compaction.reserveTokens`, which is 16,384 tokens in the current Pi settings. That is about 92% of a 200k window and 98% of a 1M window. The status does not send the reserve, so the client cannot show the real point.
- The number lags by one reply. A large tool output can raise use a lot between two readings.
- The Lit client also draws a thin bar along the input's top edge. This client does not.

## Verification

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and all tests pass. New: reading and rounding the percent, the unknown cases, a malformed reading that leaves the rest of the status intact (4), and the readout in the input bar (3). |
| Real session | Session `01a0d563…` reported 14.9%. The input bar showed 15% at all four Fold postures, in both color schemes. |
| Physical Fold | Not tested. |
