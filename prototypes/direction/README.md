# Direction

Three theses about what Forgerie **is**. Not three colour schemes.

Pick a direction before anyone argues about tokens. The visual system follows
from the thesis; it does not lead.

Serve from `prototypes/` and open any file:

```bash
node serve.mjs . 8611
# http://127.0.0.1:8611/direction/a-ledger.html
```

## The three

| | Thesis | You are… | Cost |
|---|---|---|---|
| **A. Ledger** | Forgerie is a register of work. Everything is a row. | reading one conversation, with the list always to hand | the transcript never gets the full screen |
| **B. Quiet** | Forgerie is a place you read. The transcript is the app. | deep in one session, everything else summoned | supervising several agents means constant jumping |
| **C. Floor** | Forgerie is a control room. You supervise many agents. | scanning state, drilling in only when needed | reading a long transcript is a second-class act |

### A. Ledger (`a-ledger.html`)

Linear's actual mechanism: hairline rules, no cards, tabular numerals, a
single left-aligned column of truth. The session list is permanent furniture.
Tool calls render as ledger entries in the transcript, not as boxes.

Sharp corners throughout. One accent, blue. Density 7.

### B. Quiet (`b-quiet.html`)

The opposite bet. One line of chrome at top, one composer at the bottom, and
between them a 68ch editorial measure. Navigation is a command palette that
appears and goes away. Tool work is folded into a disclosure, because it is
not the reading. An agent question is the only thing allowed to interrupt.

Soft corners, warm paper-dark, one accent, gold. Density 3.

### C. Floor (`c-floor.html`)

Sessions become tiles in lanes ordered by what they need from you. Waiting
comes first, not running. Each tile shows the live action line and the churn
so you can triage without opening anything. Lanes are
`repeat(auto-fit, minmax(300px, 1fr))`, so the Tab Ultra 11 gains lanes rather
than stretching them.

Soft corners, one accent, green. Density 6.

## Verification

`probe.html` loads every direction in an iframe at all four Fold 8 postures
and reports any element wider than the viewport.

```bash
# open http://127.0.0.1:8611/direction/probe.html
```

Result at the time of writing: 12 of 12 combinations clean, `scrollW == vw`.

**Capture warning.** The `*-up/ul/fp/fl.png` files in this folder were taken
with `chromium --headless=new --window-size=W,H`. At the narrow postures the
screenshot crops content that is not actually overflowing. Trust `probe.html`
over the PNGs when they disagree.

## Not yet decided

- Tab Ultra 11 CSS viewport is unmeasured, so none of these are validated
  there. Lane and column behaviour above 932px is untested on real hardware.
- None of these show the workspace surface (diffs, terminal, processes). That
  is deliberate: pick the thesis first.
- No direction handles the folded-landscape 711 x 374 case well. It is the
  hardest posture and all three simply get shorter.
