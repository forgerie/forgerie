# Decomposition of the browser app

This page is the project layer for three skills. Read them first:
`~/.agents/skills/atomic-decomp`, `~/.agents/skills/caliper-parts` and
`~/.agents/skills/intrinsic-design`. Also read `frontend-design`. This page
does not repeat them. It records the decisions that are specific to `ui/`.

The gates in `ui/gates/` are the authority. If this page and a gate disagree,
the gate wins, and this page must change.

## Where a file lives

Every `.tsx` file under `ui/src/` is exactly one kind. The path and the name
decide the kind.

| Kind | Path | May read state | May own CSS | Has a part |
|---|---|---|---|---|
| System component | `src/ui/<Name>.tsx` | No | Yes, `src/ui/<Name>.css` | Yes |
| Shape | `src/<feature>/<Name>.tsx` | No | No | Yes |
| Binding | `src/<feature>/<Screen>.binding.tsx` | Yes | No | No |
| Entry | `src/main.tsx` | Yes | Imports the global CSS | No |
| Part | `<Name>.<layer>.part.tsx` beside its component | No | No | n/a |
| Fixture | `src/<feature>/fixtures/*.ts` | No | No | No |

- **`src/ui/` is the shared space.** It holds system components only, flat,
  one component per file, with the hooks and logic they use. It never imports
  from a feature folder. A system component names no Forgerie concept: no
  session, worktree, model, agent, pull request, backlog and so on. The full
  list is `DOMAIN_NOUNS` in `gates/layers.test.ts`. Words reach it through props.
- **`src/ui/README.md` is the catalogue.** Every system component has one line
  there. Search it, and search `src/ui/`, before you build anything. If the
  component does not exist and its structure is generic, build it in `src/ui/`
  now, at its first call site.
- **A feature folder** is `src/<feature>/`: the feature's model (`.ts`), its
  shapes, its fixtures, and one binding per screen. Existing folders are
  `picker/`, `changes/`, `pullRequests/`, `backlog/`, `worktrees/`, `models/`,
  `agents/`, `plugins/` and `speech/`. Create `chat/`, `session/`, `newSession/`,
  `settings/` and `app/` when a lane needs them.
- **A shape is composition.** It arranges system components and passes domain
  words and data to them. It sets no `className` or `style` on an intrinsic
  element and imports no stylesheet. Plain semantic markup without a class,
  such as `<p>`, `<strong>`, `<code>` and `<ul>`, is content and is allowed.
  If a shape needs a look or a layout, a system component is missing.
- **A binding** reads the edge: stores, contexts, `fetch`, storage, sockets and
  project hooks. It passes plain values and handlers down. Only the entry and
  other bindings import a binding. React's local hooks (`useState`, `useRef`,
  `useEffect` and so on) are not state reads. A system component may keep local
  UI state, such as whether its menu is open.

## Chat views and the assistant-ui runtime

Decision A, made by the user on 2026-10-08. It holds until decision B lands.

- The chat views live in the feature folder `src/chat/`. There, and only
  there, a shape may read assistant-ui's runtime context: `useAui`,
  `useAuiState`, `useAuiEvent`, `AuiIf` and the `*Primitive` components. Every
  other state read is still a binding's job, and the shared space reads none.
- The chat binding builds the runtime from plain data with
  `useExternalStoreRuntime`, as `ForgerieSession.tsx` does today.
- A chat part builds the same runtime from fixtures, with real handlers on
  local state, through a provider in `src/chat/fixtures/`. The part never
  fetches.
- A primitive gives behaviour, not a look. Wrap a system component with
  `asChild`: `<ComposerPrimitive.Root asChild><Frame>…</Frame></ComposerPrimitive.Root>`.
  A shape never sets `className` or `style` on a primitive.

Decision B is the agreed follow-up, after A is approved: chat views take
plain props, the binding alone reads the runtime, and the exception above is
deleted from `gates/layers.test.ts`. See
`work/items/parking-lot/01M1DZ0000000000000000000B-chat-views-take-plain-props.md`.

## Tokens and CSS

- `src/ui/tokens.css` holds every raw value: colours, lengths in `px`,
  `color-mix()` derivations, font stacks. Everything else uses `var()`.
  A design input that a person may want to tune is a literal custom property
  with a `/** @label @min @max @step */` hint, so Caliper shows it as a knob.
- `src/ui/base.css` styles bare elements only: `html`, `body`, `button`,
  `:focus-visible`, `#root`. It has no class selectors.
- `src/main.tsx` imports the two fonts, `tokens.css` and `base.css`, and no
  other stylesheet.
- Each system component imports its own `<Name>.css`. A stylesheet uses only
  classes its owner renders, never `*` below a class, and never `@import`.
  A class name belongs to one component.
- An inline `style` may set custom properties only, for a measured value such
  as a drag offset: `style={{ "--sheet-offset": `${y}px` }}`.

## Layout

Layout follows `intrinsic-design`. A component decides from the size of its own
container, through container queries and container units, never from the
viewport, the device or a width breakpoint. Do not add a width breakpoint in or
near the 475 to 932 px posture range (`docs/testing.md`). A component that changes
structure at a size has a pure `plan(width, height)` with named thresholds and
unit tests one pixel either side of each threshold.

## Parts and Caliper

- A part renders the production component with fixture props and real handlers
  on local state. Time and randomness are fixed. A part never fetches.
- A page or template part is a scenario. A parent part declares its child
  states with a literal `composition` export, and a test proves the parent
  renders them.
- The devices are the four Fold 8 postures in `vite.config.ts`.
- Start the dev server for Caliper with `./scripts/caliper-dev.mjs` from `ui/`,
  as a background process. Each worktree is its own Caliper project.
- Render with
  `nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c bash -c 'CHROMIUM=$(command -v chromium) node node_modules/@simonwjackson/caliper/bin/caliper-render.mjs --url <dev url> --part "*" --state "*" --device "*" --out /tmp/<lane>'`.
  Read the PNGs. The `caliper-render` skill has the loop.

## Gates and the ratchet

```sh
nix shell nixpkgs#nodejs_24 -c npm run gates           # the gates, part of npm test
./gates/check-pending.mjs main                          # no gate's list grew since main
./gates/prove-bite.mjs                                  # every gate fails on a planted defect
```

`gates/pending.json` is the work list: the offenders that existed when the
gates were written. A gate fails on a new offender, and it also fails when a
listed offender is fixed, so delete the entry in the commit that fixes it.
`npm run gates:record` rewrites the list after files move. Read its diff. A
recording that adds an offence is a regression, and `check-pending.mjs` fails
on it. The work is done when `pending.json` is `{}` and each gate is
`expect(offenders).toEqual([])`.

## Done for one screen

1. The screen's entries are gone from `gates/pending.json`, and
   `./gates/check-pending.mjs main` passes.
2. Every component has a part with real named states, and page and template
   parts exist for the screen.
3. `caliper-render` gives `Rendered` for every state on all four devices, and
   you looked at the PNGs.
4. `npm run verify` passes in `ui/`, and the failure names match the baseline.
5. The repository's `scripts/capture-postures.mjs`, pointed at the `ui/` dev
   server, shows the screen unchanged or better in all four postures, in both
   colour schemes, and you looked at the captures. See
   [verification](../verification/README.md) for the command.
