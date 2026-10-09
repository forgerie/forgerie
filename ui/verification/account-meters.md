# Account meters

Account meters show how much quota each AI account has left. They sit at the foot of the session list, above Backlog and Settings. They are the first plugin bundled with this app. The original client's `cliproxyapi-quota` plugin (in `cliproxyapi-nix`) was the source; the rules came across and the drawing was redone in this app's style.

## What a line says

Each provider is named once, by its mark (Claude, OpenAI for Codex, Google for Antigravity, OpenRouter); hover the mark for its name. Every account under it draws one line per window the CLIProxyAPI router reports. An account with more than one line labels them (`5h`, `7d`, `Fable`, `Gemini`). An account with nothing to draw shows a quiet dash; its words say why.

- **The bar** is the share left. A 3px cut in the bar marks an even spend: the share that would be left if the window were spent at a constant rate.
- **Hatching** between the fill and the cut means the window runs dry before it resets. The clock turns red with `↓`.
- **A solid bar past the cut** is credit that will expire unspent. It runs from amber (the app's warn tone) to red by how many times the window's normal rate you would need to spend it all. The clock turns amber with `↑`.
- A lane within 8 points of the cut is on pace and draws neither.
- **A dot** is an Antigravity Gemini pool. It reports no level, only whether it answers (grey) or refuses (red).
- **A dollar amount** is an OpenRouter balance. It has no maximum, so it gets no bar.
- **The share** (`62`) and **the clock** (`5d`, the window's reset) sit at the end. Lanes that reset together and stand the same way share one clock.
- **A riser** to the left of an account marks the account the router sends work to, where a provider has more than one.

Hover a lane, or use a screen reader, for the whole line in words: "Seven-day: 20% left, resets in 4d, 30 points behind an even spend."

A reading older than five minutes fades, and the header says how old it is. If the router cannot be reached, the header says "Offline" and the last reading stays, faded. Not knowing never turns anything red.

## Room

The meters always show every account. They may take half of the height they share with the session list; past that they scroll, and the last line fades while there is more. Account addresses are shown only when they fit (`showNames` in `src/plugins/accountMeters/meterPlan.ts`); they stay in each account's hover text and screen-reader words.

The Quota header opens and closes the meters. Closed, the header is all that is left. The choice is kept in this browser.

## Settings

Settings › Plugins › Account meters. The switch shows or hides the meters at once; no restart. The Quota address is the router's `/quota` URL. One switch per window hides that window's bars. A window the router adds later has no switch and stays visible.

Values are stored under `plugins["cliproxyapi-quota"]` in Forgerie's config, the id the original plugin used, so its saved choices carry over. Only values that differ from the default are written.

The browser reads the router directly. The router must allow this app's origin (CLIProxyAPI's `-quota-origins`; today `https://forgerie.hummingbird-lake.ts.net`, `http://127.0.0.1:8504`, and `http://localhost:8504`). The Vite dev server on port 8510 is not on that list, so in development the meters say "Cannot reach …".

## Where the code lives

It follows [the decomposition](../docs/decomposition.md):

| File | Kind | Job |
|---|---|---|
| `src/ui/Shelf.tsx` | system organism | the section at the foot of a list: header, scroller, room report |
| `src/ui/LaneGrid.tsx` | system molecule | groups of lanes on shared columns |
| `src/ui/PaceBar.tsx`, `SignalDot.tsx`, `Figure.tsx`, `Glyph.tsx` | system atoms | the bar, the pool dot, a share or clock, a service mark |
| `src/ui/ErrorBoundary.tsx` | system atom | keeps a plugin that throws in its own place |
| `src/plugins/accountMeters/AccountMeters.tsx` | shape | turns meter rows into lanes; no styles of its own |
| `src/plugins/accountMeters/AccountMeters.binding.tsx` | binding | reads the router, the stored choice, and the room |
| `src/plugins/PickerShelves.binding.tsx` | binding | the plugin registry and the slot under the session list |
| `quotaData.ts`, `meterModel.ts`, `meterPlan.ts` | logic | the router contract, rows, and what fits |

Each component has a part beside it. `src/plugins/accountMeters/fixtures/quota.ts` holds the reading the parts draw.

## Check it

```sh
# Captures at every Fold posture and both schemes. The quota is served by CDP interception, so any origin works.
APP_URL=http://127.0.0.1:8504/ OUT=verification/local/meters-shots node scripts/meters-shots.mjs
# Every state of every new part, on the four postures (start ./scripts/caliper-dev.mjs first).
# caliper-render --url <dev url> --part src/plugins/accountMeters/AccountMeters.organism.part.tsx --state '*' --device '*'
CLOSED=1 APP_URL=... node scripts/meters-shots.mjs      # closed from the header
OFFLINE=1 APP_URL=... node scripts/meters-shots.mjs     # the router unreachable

# Settings drives the meters without a reload. Writes and restores the plugin's settings.
APP_URL=http://127.0.0.1:8504/ QUOTA_FILE=/tmp/quota.json node scripts/meters-settings-acceptance.mjs
```

Measured on 2026-10-09 against the live reading (4 providers, 7 accounts, five windows turned off), open, with the project-group controls of `main` above the list:

| Posture | Picker | Meters | List keeps | Scrolls |
|---|---|---|---|---|
| Unfolded portrait | 287 × 783 | 223px | 227px | no |
| Unfolded landscape | 287 × 553 | 110px | 110px | yes |
| Folded portrait | 287 × 638 | 153px | 153px | yes |
| Folded landscape | 287 × 374 | 37px, header only | 16px | n/a |
| Docked 1280 × 860 | 281 × 860 | 223px | 304px | no |

Closed, the meters are the 37px header at every posture.

## Limits

- The sizes in `meterPlan.ts` mirror `src/ui/LaneGrid.css` and `src/ui/Shelf.css`. Change both together.
- The plugin's manifest is in `src/shared/appPluginManifests.ts`, because the server lists and validates it, and sends its settings with the catalog so Settings never imports a plugin.
- In folded landscape the project-group controls leave the list and the meters 53px between them. The Quota header keeps its 37px, so the open meters show no lanes there until the space grows. Press the header to close them.
- The provider marks are in `providerMarks.ts`, from Simple Icons (CC0). They are their owners' trademarks. OpenAI's mark comes from Simple Icons 13.0.0, because later versions removed it.
