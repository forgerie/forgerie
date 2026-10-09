# Forgerie

Forgerie is a web-based control surface for the Pi coding agent: multi-project,
multi-session, server-hosted, browser-driven. It is a **hard fork** of
[jmfederico/pi-web](https://github.com/jmfederico/pi-web), kept as its own
product. The UX will diverge heavily from upstream by design.

## Fork model: quasi-upstream via `upstream.lock`

We do not merge from upstream. Upstream is a supplier of ideas and fixes that
we review deliberately and adopt selectively.

- `upstream.lock` (repo root) pins the last upstream commit we have fully
  reviewed. It is a cursor, not a dependency. "Everything up to this commit has
  been seen and judged."
- The git remote `upstream` points at jmfederico/pi-web. There is no tracking
  relationship between our branches and upstream branches.
- Divergence is expected and permanent. Do not try to keep files mergeable
  with upstream. Never run `git merge upstream/main`.

### Upstream review ritual

When asked to "review upstream", "catch up with upstream", or similar:

1. Read `upstream.lock` for the current cursor commit.
2. `git fetch upstream`, then diff/log from the cursor to `upstream/main`:
   `git log --oneline <cursor>..upstream/main` and targeted
   `git diff <cursor>..upstream/main -- <paths>`.
3. Produce a digest grouped by relevance, not by commit:
   - **Adopt**: fixes and features we want (sessiond/session-daemon fixes,
     reconnect/persistence work, security fixes are high priority).
   - **Skip**: upstream UI/UX work that conflicts with our diverged UX,
     or features we do not want. Say why.
   - **Discuss**: anything ambiguous. Ask before porting.
4. Port adopted changes **semantically**: reimplement them against our
   diverged code. Cherry-picks are allowed only when the touched files have
   not diverged; otherwise rewrite by hand. Never resolve a port by reverting
   our divergence.
5. Record the session in `docs/upstream-reviews/YYYY-MM-DD.md`: cursor range
   reviewed, what was adopted (with our commit shas), what was skipped and
   why. Skipped decisions are final unless the user reopens them — do not
   re-litigate old skips in later reviews.
6. Advance `upstream.lock` to the reviewed upstream commit (update
   `reviewedCommit`, `reviewedDescribe`, `reviewedAt`).

The lock file only ever moves forward, and only at the end of a completed
review. A partial review does not move the cursor.

### Adoption priorities

- **High**: `src/server/sessiond*`, session persistence, reconnect/replay,
  ask/dialog stores, child-agent persistence, security fixes, pi SDK version
  bumps (`@earendil-works/pi-*`).
- **Low / usually skip**: upstream client UI (`src/client/`), styling, bundled
  plugin UX — this is where we diverge.

## Git workspace

New Forgerie worktrees use `.worktrees/<name>`. This overrides the `.worktree/`
folder in the global Git workspace rule. Keep the same branch, rebase,
fast-forward, and removal procedure. Existing `.worktree/` checkouts stay at
their recorded paths; moving them requires explicit user approval.

## Machine-local instructions

If `AGENTS.local.md` exists in the repo root (gitignored, per-machine), read
it before making changes. It carries the local deployment rules — including
the standing rule that **user-facing changes on `main` must be followed by
updating/restarting the local systemd user units**, so the running instance
tracks `main` without a NixOS rebuild.

## Product facts

- Runs on the user's server (zao, NixOS), accessed over Tailscale only. No
  auth layer of its own; network exposure is Tailscale's job.
- Chat is fully web-native. Session shell commands and managed processes
  provide command execution without embedded terminals.
- Uses the configured Pi profile for credentials, sessions, packages, and
  extensions. Read `AGENTS.local.md` for this host's active profile.
- The daemon's `ask_user` custom tool shadows any extension-registered
  `ask_user` (pi merges tools by name, SDK customTools last). Forgerie bundles
  its own `ask-user` decision-gate skill (`skills/ask-user`), written for this
  tool's schema; it does not load the `pi-ask-user` package.
- Provider registrations freeze at sessiond startup. Provider/extension
  changes need a sessiond restart, not `/reload`.
- Managed background processes are first-class: `ad-process:notification`
  messages render as chat cards, and the Processes workspace panel exposes the
  selected session's list, logs, stop, and capability-gated stdin. Forgerie
  bundles its patched `pi-processes` dependency under `vendor/pi-processes` and
  loads it without machine-configuration support. Keep its divergence to the
  non-login spawn fix and additive stdin-write protocol.
- Codemode is on by default (`codemode` in Forgerie config). Forgerie loads
  Pi's `builtin:codemode` extension and activates the tool with an in-memory
  `defaultTools` override; it never writes that override to the shared Pi
  profile, whose terminal Pi may predate `+name` entries. A script's calls
  are not transcript entries: the server drops their `tool_execution_*`
  events, and the card reads `details.calls`. Give a Forgerie tool
  `exposure: "model-only"` (`MODEL_ONLY_EXPOSURE`) when it ends the run or
  starts something the transcript must show.
- Delegated agents are first-class: Forgerie bundles an exact, unpatched
  `pi-subagents` npm version and loads it into every hosted session
  (`src/server/sessions/bundledSubagents.ts`). A role lives in one agent file
  (`description`, `advertise: true`, `model`); do not add routing rules to
  instruction files. A different `pi-subagents` copy in the Pi profile is
  dropped with a warning; point the profile at Forgerie's bundled path instead.
  Upgrade by bumping the exact version, then run `npm run verify` and the
  package smoke test.
- Durable child agents are the opt-in successor (`durableChildren`): the
  `child_agent` tool runs children inside the parent session's Durable
  storage, and the browser opens, steers, stops, and answers them without a
  parent turn. Both systems load side by side until the Durable one covers
  the uses of pi-subagents. See `docs/child-agents.md`.

## Acceptance device and visual testing

The acceptance target is the user's daily driver: **Samsung Galaxy Z Fold 8
(non-Ultra)**. Every user-facing change must be validated on this device's
full posture matrix before it is called done.

Physical panels:

- Unfolded (main): 2448 × 1848 px, 7.6", 4:3
- Folded (cover): 1972 × 1248 px, 5.5", ~10:16

CSS-pixel viewports measured on the physical device (DPR 2.625):

| Posture | CSS viewport (w × h) |
|---|---|
| Unfolded portrait | 704 × 783 |
| Unfolded landscape | 932 × 553 |
| Folded portrait | 475 × 638 |
| Folded landscape | 711 × 374 |

Headless capture — use the posture script, never raw `--window-size`:

```bash
node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ \
  --out /tmp/shots --label baseline --color-scheme dark
```

The script drives real viewport emulation over CDP
(`Emulation.setDeviceMetricsOverride`) and emulates `prefers-color-scheme`
so the app's auto theme pair resolves the way it does on device.

**Do not capture with `chromium --window-size=W,H --screenshot`.** The
window size is not the viewport: headless Chromium clamps small window
widths (measured: a 475px request lays out at ~500px and the screenshot
crops the right edge) and the height budget differs from the viewport.
This produced false "clipped control" and "dead band" defect reports at
the folded postures before the discrepancy was caught.

Repeat for both color schemes. The agent must **look at** the captures (Read
the PNGs) and judge them — capturing without reviewing does not count as
validation.

### Additional acceptance device

- **Samsung Tab Ultra 11**: 2960 × 1848 px, 14.6-inch panel.

Its CSS viewport and device pixel ratio have not been measured. Do not derive
them from the physical resolution. Once measured on the real device, record
portrait and landscape CSS viewports here and include both orientations in
user-facing visual validation. No Tab Ultra 11 validation was required when
this device entry was added.

### Seamlessness requirement

The UX must be seamless across all four postures and the transitions between
them (fold/unfold, rotate). The same surface must not flip between unrelated
layout paradigms across adjacent postures.

Known upstream defect (fork point): a viewport-width breakpoint near ~768px
splits this device's posture matrix — 704px (unfolded portrait) renders the
phone layout while 932px (unfolded landscape) renders the desktop layout.
Rotating the unfolded device swaps the entire UI paradigm. Removing this
cliff is a standing UX goal; do not add new width breakpoints that fall
inside or near the 475–932px posture range.

### Decomposition of the browser app

Before you add or change a component in `ui/`, read `ui/docs/decomposition.md`.
It says where system components, shapes, bindings and parts live, and how the
gates in `ui/gates/` enforce it.

### Intrinsic design rules

All Forgerie UI work follows intrinsic design principles:

- Components respond to their **container**, not the viewport. Use container
  queries and container-relative units; reserve viewport units for the page
  frame itself.
- Size and space fluidly: `clamp()`, `min()`, `max()`, flexible tracks — not
  stepped values keyed to device classes.
- Grids and lists gain or lose tracks from available space
  (`repeat(auto-fit, minmax(…))`), never from a hardcoded column count per
  breakpoint.
- Layout changes are continuous morphs driven by available space. A discrete
  layout change (e.g. sidebar collapses to a drawer) must key off the space
  the component actually has, and must hold state across the change —
  scroll position, draft text, open panels survive fold/unfold and rotation.
- No user-agent, touch, or device-model sniffing for layout decisions.

## Upstream inheritance

- License: MIT (upstream © Federico Jaramillo Martinez). Keep attribution.
- Before any publish: rename the npm package and bins; do not ship as
  `@jmfederico/pi-web`.
- Dev commands (inherited, still valid until we change them):
  - `npm install` then `npm run dev` (sessiond + web + client watchers)
  - `npm run verify` (typecheck, lint, knip, tests) — run before commits
  - Develop, test, and deploy on Node 24: `nix shell nixpkgs#nodejs_24`.
    Caliper needs Node 24 to run the `ui/` dev server. The published
    package still declares `node >= 22.19.0`; nothing tests that floor.
