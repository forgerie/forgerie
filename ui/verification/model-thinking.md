# Model and thinking level

The input bar shows the session's model and thinking level as Pi reports them, for example "Claude Opus 5.5  High". Press it to open the picker. Type `/model`, or `/model` and some search text, then Send or Enter: the picker opens with that search, and nothing is sent to Pi.

| Action | What happens |
| --- | --- |
| Pick a model. | Pi switches this session's model. The picker closes and focus returns to the trigger. Pi may change the thinking level to one the new model allows. |
| Pick a thinking level. | Pi changes this session's level. The picker stays open, so you can compare levels. |
| Search. | Filters by model name, ID, or provider. |
| Escape, or a tap outside. | Closes the picker. The draft stays. |
| Arrow Up and Down. | Move between models. |

The change applies to this session only. Forgerie's server calls Pi's `setModel` without `persist`, so Pi's default model in `~/.pi/agent/settings.json` stays the same. New sessions still start with Pi's default.

## What the picker shows

- Pi's enabled models (`enabledModels`) first, as "Enabled models", each with its provider. Then every other model, grouped by provider in Pi's order. A later run of one provider gets its own group, so the server's order stays intact.
- Each row shows the context window in k or m. A dated snapshot shows its date, and Pi's moving alias shows "latest". A model without reasoning says "no thinking".
- The thinking row lists the levels Pi allows for the current model, read again after every model change. A model with only "off" shows "This model does not think."

The design follows assistant-ui's [model selector element](https://www.assistant-ui.com/docs/ui/model-selector): a ghost trigger in the composer row, a searchable list grouped by provider, and the thinking level at the bottom, nearest the trigger. Shipped references on Mobbin put the model choice in the same place: [Microsoft Copilot](https://mobbin.com/screens/402c35af-6cfa-43c8-9dd6-31d1c52f0e21), [v0](https://mobbin.com/screens/f5d76ed6-98ce-403c-bcab-65c93c3070d8), and [Dropbox Dash](https://mobbin.com/screens/536f1280-e59b-43c4-8dd0-3f0e91e15695). The shadcn element itself is not installed: it needs Tailwind and cmdk, which this app does not use.

## Layout

The trigger's model name is a readout. It truncates first, and the level and chevron keep their width. The full name stays in the picker. The picker opens at window level, above or below the input bar, wherever there is more room, and is never wider than the bar. Search and the thinking row stay in place, and only the list scrolls. The panel keeps at least one model row visible at every tested size, including a 475 × 280 keyboard budget and a 280 × 500 pane.

## Contract and limits

- Reads: `GET /api/sessions/:id/models` and `GET /api/sessions/:id/thinking-levels`. Writes: `POST /api/sessions/:id/model` with `{ cwd, provider, modelId }`, and `POST /api/sessions/:id/thinking-level` with `{ cwd, level }`. Both writes answer with session status.
- `status.model` and `status.thinkingLevel` drive the trigger. Live `status.update` events keep it current when another window or the terminal changes the model.
- Nothing changes in the browser until Pi answers. A refusal keeps the old choice and shows Pi's message in the picker. A lost acknowledgement is never retried. The message says the change may have applied.
- The backend's `/model` command is not used. The server answers it with "not implemented in the web UI yet", so the composer handles `/model` itself.
- The models list loads each time the picker opens. There is no cache.
- Model cycling (`/model/cycle`, `/thinking-level/cycle`) has no control or key here.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/model-acceptance.mjs
./scripts/model-shots.mjs
./scripts/real-model-check.mjs
```

Set `APP_URL` when the dev server is not on port 8510, and `FORGERIE_ROOT` when the parent checkout is not two folders up. `real-model-check.mjs` creates and archives its own scratch session in a temporary folder. It sends one short prompt, so it costs normal model usage. The other scripts use local fixtures and make no API requests.

| Check | Result (2026-10-05) |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 488 unit tests passed. New tests cover grouping, search, labels, `/model` parsing, status parsing, the reads, both writes, a refusal, a lost acknowledgement without retry, and the composer: trigger, groups, focus, pick model, pick level, refusal, no-thinking model, search, Escape, `/model`, offline, and a failed read. |
| Browser fixtures. | `model-acceptance.mjs` passed 60 scenario, theme, and size combinations: four Fold postures, a 475 × 280 keyboard budget, and a 280 × 500 pane. It checked no page overflow, one input, the trigger and every composer button on screen, the panel, search, thinking row, and levels on screen, and at least one visible model row. Flows: pick a model, pick a level, close with Escape and with a tap outside, `/model haiku`, and a refusal. The open picker and the draft survived fold, unfold, and rotation. No API mutation and no page error. The other fixture scripts (ask, compaction, queue, shell, skills, slash, mentions, streamdown, trace, visual, dictation) still pass. |
| Visual review. | All 32 captures from `model-shots.mjs` were read in contact sheets: closed, open, a model without thinking, and a long model name, at four Fold postures in both themes. |
| Real session. | `real-model-check.mjs` passed against the live backend at folded portrait. The trigger named Pi's model and level. The picker listed all 44 models Pi offers and the current model's 5 levels. A level change and a model change reached Pi, the trigger followed, and a reload showed the saved choice. Pi's `settings.json` did not change. |

Not verified: a physical Fold.

## Review fixes (2026-10-05)

An independent review found 8 should-fix items and 4 nits. All the should-fix items are fixed:

- Focus moves into the picker as soon as it opens, so Escape closes it while the models load. Before, Escape could reach the input and stop the run. The current model takes focus once the list loads, unless you have already moved.
- A full `/model` opens the picker on the first Enter, even while the slash list offers "model".
- While a change runs, the picker stays open: a tap outside, the trigger, and Escape all wait for Pi. The result and any error land in the picker that sent it.
- Busy rows and levels use `aria-disabled`, so a keyboard user keeps focus on the pressed control.
- Only a 4xx answer (not 408 or 429) counts as a refusal. A 5xx or proxy error says the change may have applied. Dialog answers and `!` commands follow the same rule.
- The model name truncates before the trigger wraps to its own row. Spacing in the bar yields first, and below 22rem the level moves into the picker, where it is always shown. Checked at 275 × 280.
- The picker scrolls as a whole when the room is short, and a refusal shows under the search box, so neither the thinking row nor the error is cut off.
- Model rows mark the current model with `aria-current`. Groups are named by their visible heading. The trigger's accessible name starts with its visible text.

Also: a late read after a model change can no longer overwrite the newer one. Not changed: `/model` with attachments or during an ask still goes to the server, which answers "not implemented".

The same pass fixed an extension-dialog head that overlapped at 275 px: the countdown now truncates first.
