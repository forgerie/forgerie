# Account meters

Account meters show how much quota each AI account has left. They sit at the foot of the session list, above Backlog and Settings. They are the first plugin bundled with this app. The original client's `cliproxyapi-quota` plugin (in `cliproxyapi-nix`) was the source; the rules came across and the drawing was redone in this app's style.

## What a line says

Each provider is named once, by its mark (Claude, OpenAI for Codex, Google for Antigravity, OpenRouter); hover the mark for its name. Every account under it draws one line per window the CLIProxyAPI router reports. The meters are a heads-up display: no account address is drawn, at any size. Press an account for the detail sheet (below). An account with more than one line labels them (`5h`, `7d`, `Fable`, `Gemini`). An account with nothing to draw shows a quiet dash; its words say why.

- **The bar** is the share left. A 3px cut in the bar marks an even spend: the share that would be left if the window were spent at a constant rate.
- **Hatching** between the fill and the cut means the window runs dry before it resets. The clock turns red with `↓`.
- **A solid bar past the cut** is credit that will expire unspent. It runs from amber (the app's warn tone) to red by how many times the window's normal rate you would need to spend it all. The clock turns amber with `↑`.
- A lane within 8 points of the cut is on pace and draws neither.
- **A dot and its clock** is an Antigravity Gemini pool. It reports no level, so it draws no lane. The dot is grey while it answers and red while it refuses; a refusing pool's clock also turns red with `↓`, as a lane run dry does, because it serves nothing until that reset.
- **A dollar amount** is an OpenRouter balance (`$7`). It turns amber at $2 or less and red at $0. A balance never resets, so it has no clock.
- A service whose accounts are each one such reading puts them **side by side on one line** after its mark (`● 6d   ▏● 5h`), instead of a line each.
- **A blue service mark** means at least one of its accounts has a banked reset; amber when one lapses within three days. Hover the mark for how many accounts. Which account, and spending it, is in the detail sheet.
- An account the router has taken out of service is not shown. The detail sheet still lists it, struck through.
- **The share** (`62`) and **the clock** (`5d`, the window's reset) sit at the end. Lanes that reset together and stand the same way share one clock.
- **A riser** to the left of an account marks the account the router sends work to, where a provider has more than one.

Hover a lane, or use a screen reader, for the whole line in words: "Seven-day: 20% left, resets in 4d, 30 points behind an even spend."

A reading older than five minutes fades, and the header says how old it is. If the router cannot be reached, the header says "Offline" and the last reading stays, faded. Not knowing never turns anything red.

## Room

The meters always show every account. They may take half of the height they share with the session list; past that they scroll, and the last line fades while there is more. Addresses are never drawn here; they stay in each account's screen-reader name and in the detail sheet.

The Quota header opens and closes the meters. Closed, the header is all that is left. The choice is kept in this browser.

## The detail sheet

Press any account in the meters, or tab to it and press Enter, to open the Quota sheet at that account. The account you pressed is marked and brought into view. The sheet draws the same lanes one step larger, by the same rules, with what the meters leave out:

- each account's address, struck through when it is out of service;
- every account, including those out of service, struck through;
- every window, including the ones turned off in Settings;
- a pool as a run of dots across its lane, and a balance as one pip per whole dollar (fading out past about 24);
- the reset chips, which open the reset question over the sheet. Resets are spent only from here.

The refresh icon reads the router again. A reading older than five minutes says its age beside the title, and fades, as in the meters.

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
| `src/ui/SheetDialog.tsx` | system organism | the detail sheet's frame |
| `src/ui/PaceBar.tsx`, `SignalDot.tsx`, `PipRun.tsx`, `Figure.tsx`, `Glyph.tsx` | system atoms | the bar, the pool's dots, the balance's pips, a share or clock, a service mark |
| `src/ui/ErrorBoundary.tsx` | system atom | keeps a plugin that throws in its own place |
| `src/plugins/accountMeters/AccountMeters.tsx` | shape | turns meter rows into lanes; no styles of its own |
| `src/plugins/accountMeters/QuotaSheet.tsx` | shape | the same lanes in the detail sheet, with addresses |
| `src/plugins/accountMeters/AccountMeters.binding.tsx` | binding | reads the router and the stored choice; opens the sheet and the reset question |
| `src/plugins/PickerShelves.binding.tsx` | binding | the plugin registry and the slot under the session list |
| `quotaData.ts`, `meterModel.ts` | logic | the router contract and rows |

Each component has a part beside it. `src/plugins/accountMeters/fixtures/quota.ts` holds the reading the parts draw.

## Check it

```sh
# Captures at every Fold posture and both schemes. The quota is served by CDP interception, so any origin works.
APP_URL=http://127.0.0.1:8504/ OUT=verification/local/meters-shots node scripts/meters-shots.mjs
# Every state of every new part, on the four postures (start ./scripts/caliper-dev.mjs first).
# caliper-render --url <dev url> --part src/plugins/accountMeters/AccountMeters.organism.part.tsx --state '*' --device '*'
CLOSED=1 APP_URL=... node scripts/meters-shots.mjs      # closed from the header
OFFLINE=1 APP_URL=... node scripts/meters-shots.mjs     # the router unreachable
SHEET=1 SHEET_AT=3 APP_URL=... node scripts/meters-shots.mjs  # press the fourth account; capture the sheet

# Settings drives the meters without a reload. Writes and restores the plugin's settings.
APP_URL=http://127.0.0.1:8504/ QUOTA_FILE=/tmp/quota.json node scripts/meters-settings-acceptance.mjs
```

Measured on 2026-10-10 against the live reading (4 providers, 7 accounts), open, with no addresses in the meters:

| Posture | Meters | List keeps | Meters scroll | Sheet scrolls |
|---|---|---|---|---|
| Unfolded portrait | 223px | 403px | no | no |
| Unfolded landscape | 198px | 198px | yes | yes |
| Folded portrait | 223px | 258px | no | yes |
| Folded landscape | 109px | 109px | yes | yes |
| Docked 1280 × 860 | 223px | 480px | no | no |

In every posture the sheet opened with the pressed account in view and nothing wider than the window. Closed, the meters are the 37px header at every posture.

## Limits

- A touch screen has no hover, so nothing in the meters shows that an account opens the sheet until it is pressed.
- The sheet does not mark which windows are turned off in the meters.
- The plugin's manifest is in `src/shared/appPluginManifests.ts`, because the server lists and validates it, and sends its settings with the catalog so Settings never imports a plugin.
- The provider marks are in `providerMarks.ts`, from Simple Icons (CC0). They are their owners' trademarks. OpenAI's mark comes from Simple Icons 13.0.0, because later versions removed it.
