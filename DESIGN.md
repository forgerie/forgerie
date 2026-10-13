---
version: alpha
name: Forgerie
description: A tally sheet for agent work. One block is one unit of work, everywhere.
colors:
  primary: "oklch(0.205 0.006 106)"
  on-primary: "oklch(0.985 0.003 106)"
  paper: "oklch(0.992 0.002 106)"
  ink: "oklch(0.145 0.006 106)"
  muted: "oklch(0.97 0.004 106)"
  muted-ink: "oklch(0.556 0.007 106)"
  live: "oklch(0.623 0.214 259.815)"
  bad: "oklch(0.6 0.2 25)"
  warn: "oklch(0.6 0.13 70)"
  good: "oklch(0.6 0.15 150)"
  destructive: "oklch(0.577 0.245 27.325)"
  primary-dark: "oklch(0.922 0.002 106)"
  on-primary-dark: "oklch(0.215 0.003 106)"
  paper-dark: "oklch(0.17 0.003 106)"
  ink-dark: "oklch(0.985 0.002 106)"
  muted-dark: "oklch(0.275 0.004 106)"
  muted-ink-dark: "oklch(0.708 0.004 106)"
  bad-dark: "oklch(0.7 0.19 25)"
  warn-dark: "oklch(0.76 0.13 80)"
  good-dark: "oklch(0.72 0.16 150)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1.5rem
    fontWeight: 550
    lineHeight: 1.375
    letterSpacing: -0.01em
  body:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.625
  small:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: 0.8125rem
    fontWeight: 400
  label:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
  meta:
    fontFamily: "Public Sans Variable, sans-serif"
    fontSize: 0.6875rem
  code:
    fontFamily: "JetBrains Mono Variable, monospace"
    fontSize: 0.78125rem
rounded:
  mark: 0.109375rem
  document: 0.375rem
  control: 0.5rem
  surface: 0.625rem
  thread: 1rem
  pill: 999px
spacing:
  mark-gap: 0.1875rem
  "1": 0.25rem
  "2": 0.5rem
  "3": 0.75rem
  "4": 1rem
  "5": 1.25rem
  "6": 1.5rem
  "8": 2rem
  control: 2.75rem
  tally-gutter: 2.25rem
components:
  tally-mark:
    backgroundColor: "{colors.muted-ink}"
    rounded: "{rounded.mark}"
    size: 0.4375rem
  tally-mark-live:
    backgroundColor: "{colors.live}"
    rounded: "{rounded.mark}"
    size: 0.4375rem
  tally-mark-bad:
    backgroundColor: "{colors.bad}"
    rounded: "{rounded.mark}"
    size: 0.4375rem
  tally-mark-warn:
    backgroundColor: "{colors.warn}"
    rounded: "{rounded.mark}"
    size: 0.4375rem
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: 0 0.75rem
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.small}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: 0 0.75rem
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  user-bubble:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.thread}"
    padding: 0.5rem 1rem
  status-chip:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 1.5rem
---

# Design System: Forgerie

<!-- Draft written on 2026-10-12 from ui/src/ui/theme.css, ui/src/ui/TallyRow.css,
docs/brand/README.md and the watch prototype (branch proto/watch-home-sim).
The tokens above copy theme.css. If the two disagree, theme.css wins; fix
this file. -->

## Overview

**Creative North Star: "The Tally Sheet"**

Forgerie is where Simon watches agents work and decides what they do next.
The interface reads like a tally sheet kept in the margin of a conversation.
Prose sits in the middle. In the margin, one small block marks each unit of
work, so the amount and the state of the work show before any words do.

The surface is quiet. Neutral ink on paper carries almost everything. Colour
appears only when a block or a meter has news: work is moving, something
failed, or something waits on the reader. Density is moderate: one reading
column (42rem at most) with generous line height, controls drawn small but
pressed large.

The logo is built from the same block. Eight tally marks on a 3 × 3 grid
make an F. So the brand mark, the chat margin, and the watch face all use
one shape with one meaning.

**Key Characteristics:**

- One motif, the block, with a fixed shape and a fixed meaning.
- Neutral at rest. Colour is a signal, never decoration.
- A single reading column. Layout follows the container, not the device.
- Flat surfaces separated by hairlines and faint washes, not shadows.
- Show, do not tell: a state is drawn before it is written.

## Motif

The block is Forgerie's motif. Every other pattern in this file grows from it.

### Construction

- **Shape:** a square.
- **Gap:** 3/7 of the side. In the browser app a mark is 7 px with a 3 px gap
  (`{spacing.mark-gap}`).
- **Corner:** a radius of 1/4 of the side (`{rounded.mark}` at 7 px).
- **Grouping:** blocks wrap three wide, right-aligned in a margin column of
  `{spacing.tally-gutter}`. The first row centres on the first line of text.

Keep these ratios at every size. The logo's large drawing uses the same 7 : 3
ratio. The 16 px drawing (4 px marks, 1 px gaps) is the only exception, so
that every edge lands on a whole pixel. See `docs/brand/README.md`.

### Meaning

**The One Block, One Unit Rule.** A block always counts one unit of work: a
tool call in a reply, or a child agent in a session. A block never stands for
anything else.

| Tone | Drawn as | Means |
|---|---|---|
| plain | Neutral ink, 52 % | Done |
| live | `{colors.live}`, blinking (1.2 s) | Running now |
| bad | `{colors.bad}` | Failed |
| warn | `{colors.warn}` | Failed, then retried and passed |
| faint | Hollow, a hairline outline | Stopped before it finished |
| needs | Full ink (watch prototype only) | Waits on the reader |

**The Worst Tone Wins Rule.** When marks do not fit and the tail becomes a
"+N" count, the count takes the worst tone it hides. The order is plain,
faint, live, warn, bad. A failure is never hidden by a summary.

### Patterns built from the block

Each pattern below is the block, repeated or arranged. A new pattern must be
one too, or it does not belong to the motif.

- **Tally row:** blocks in the margin beside a reply or a step list. The
  blocks open a panel that lists the work. (`TallyRow`)
- **Logo mark:** eight blocks on a 3 × 3 grid that form an F, with one bad
  and two live blocks outside it. (`LogoMark`)
- **Session row (watch):** a session's agents as blocks, then its title. One
  face lists every session from every project.
- **Rim count (watch):** blocks that need the reader, centred at twelve
  o'clock on the round face.
- **Whole ring (watch):** every block around the rim at once. Blinking live
  means listening. A chase means thinking. Dark with one bad block means
  offline.
- **Confirm ring (watch):** blocks turn to ink one by one, clockwise from
  twelve, while the reader holds an action that cannot be undone.
- **Back chevron (watch):** three blocks in a "<" at nine o'clock.

Pips (`PipRun`), meters (`PaceBar`) and signal dots (`SignalDot`) are
relatives, not members. They share the meter's ink and height, but they
measure an amount, not units of work.

## Colors

Warm-neutral greys (hue 106) with four signal tones. The app follows the
system's light or dark setting; tokens ending in `-dark` are the dark values.
The DESIGN.md format has no dark-mode field, so the linter reports the dark
tokens as unused.

### Primary

- **Press Ink** (`{colors.primary}`, dark `{colors.primary-dark}`): the one
  filled button in a group, and the user's own text.

### Neutral

- **Paper** (`{colors.paper}`, dark `{colors.paper-dark}`): the page.
- **Ink** (`{colors.ink}`, dark `{colors.ink-dark}`): body text.
- **Muted** (`{colors.muted}`): the user's bubble and quiet chips.
- **Muted Ink** (`{colors.muted-ink}`): labels, meta text, done blocks.
- Hairlines are ink at 10 % (`--line`), and 25 % on focus (`--line-focus`).
  Hover and active washes are ink at 4 % and 6 %.

### Signal tones

- **Live Blue** (`{colors.live}`): work that is moving, and an open
  decision's edge and title.
- **Bad Red** (`{colors.bad}`, dark `{colors.bad-dark}`): failed work and
  removed lines in a diff.
- **Warn Amber** (`{colors.warn}`, dark `{colors.warn-dark}`): retried work,
  a meter's shortfall, changed lines.
- **Good Green** (`{colors.good}`, dark `{colors.good-dark}`): added lines and
  passing facts.
- **Destructive** (`{colors.destructive}`): errors and danger buttons.

**The Neutral At Rest Rule.** A healthy surface is grey. A meter draws neutral
ink until something is wrong; warn and danger tones always mean a problem.

**The Tone Means One Thing Rule.** A tone keeps its meaning on every surface.
Live is always "moving", bad is always "failed".

## Typography

**Body Font:** Public Sans Variable (with sans-serif)
**Display Font:** the system UI face
**Code Font:** JetBrains Mono Variable (with monospace)

**Character:** a plain, sturdy text face for reading, a monospace face for
anything the agent did, and the platform's own face for the few headings.

### Hierarchy

- **Display** (550, 1.5rem, 1.375): the empty-thread welcome and Markdown
  headings.
- **Body** (400, 0.9375rem, 1.625): replies and the composer.
- **Small** (400, 0.8125rem): session titles, buttons, notes.
- **Label** (500, 0.75rem): field labels, chips, tally lines (in the code
  font).
- **Meta** (0.6875rem): counts and lane values, with tabular numbers.
- **Code** (0.78125rem): tool names, paths, commands. Ligatures off.

**The Work Speaks Mono Rule.** Text that names what an agent did (a tool, a
path, a command, a tally line) is set in the code font. Text written for the
reader is set in Public Sans.

## Layout

One reading column, at most `--thread-max-width` (42rem), centred, with a
fluid gutter (`clamp(1rem, 2.6cqi, 1.5rem)`). Space between messages and
around the thread is fluid on the container's height.

Spacing steps are `{spacing.1}` to `{spacing.8}` (0.25rem to 2rem).

Components respond to their container, using container queries and
container units. Width breakpoints are not allowed in the 475–932 px range,
because the Galaxy Z Fold's postures fall there. A discrete change keys off
the space the component has, and keeps its state through the change.

On the round watch (407 × 407 CSS px), content sits in a central rectangle
whose corners touch the circle. The rim belongs to the blocks.

## Elevation & Depth

Flat by default. Surfaces are separated by hairlines (`--hairline`, 1 px) and
faint ink washes (`--tint-surface`, ink at 2.5 %), not by shadows. Only
floating layers lift:

- **Float** (`--float-shadow`): menus and floating panels.
- **Modal** (`--modal-shadow`, with a 3 px backdrop blur): dialogs and sheets.

In the dark scheme, both shadows add a 1 px inner highlight at the top edge.

**The Flat Unless Floating Rule.** A surface that stays in the page has no
shadow.

## Shapes

Gently rounded rectangles, sized by role: documents `{rounded.document}`,
controls `{rounded.control}`, surfaces and cards `{rounded.surface}`, the
user's bubble `{rounded.thread}`, chips `{rounded.pill}`. The block's corner
is always a quarter of its side.

## Components

### Buttons

- **Shape:** `{rounded.control}`, at least `{spacing.control}` (44 px) tall.
- **Default:** paper with a hairline border; the border darkens on hover.
- **Primary:** Press Ink fill, no border. One per group.
- **Danger:** destructive text and a destructive hairline.

**The Drawn Small, Pressed Large Rule.** An icon control may be drawn smaller
than 44 px, but its hit area is always at least `{spacing.control}`, through
an invisible layer centred on it.

### Decision card

Something that waits on the reader. It is not a box: no border, no wash, no
icon. A 2 px rule on its start side marks it, and the content sits a step in
from the rule.

- **Open:** the rule and the title are live. The body reads at body size.
  The choices sit under it, with the one primary choice filled.
- **Decided:** the rule turns to the focus hairline (`--line-focus`) and the
  title to muted ink. The choices give way to one line that says what was
  decided.

The same card shows the same decision wherever it appears, such as in the
chat and in a workflow's sheet. (`DecisionCard`)

A question that waits on the reader uses the same rule: the asker in the
code font, live while open, then the question and a reply box. Once
answered, the question turns muted and the answer follows it.
(`QuestionCard`)

### Status chip

A header's one status word, as a pill with a dot. A healthy status draws
nothing; screen readers still hear it.

### Tally row

The motif's home in the browser. See Motif.

## Do's and Don'ts

### Do:

- **Do** use a block only to count units of work, with one of the tones in
  the Motif table.
- **Do** keep the block's ratios: gap 3/7 of the side, corner 1/4.
- **Do** draw a state before writing it. On small screens, let the blocks
  and rings carry the state, and cut the words.
- **Do** keep every control's hit area at least 44 px.
- **Do** stop live motion under `prefers-reduced-motion`.

### Don't:

- **Don't** use blocks as decoration, dividers, bullets or loading spinners
  that do not count work. A block that means nothing weakens every block.
- **Don't** colour a healthy state. Grey is the resting state.
- **Don't** give a tone a second meaning on a new surface.
- **Don't** add width breakpoints between 475 and 932 px.
- **Don't** add shadows to surfaces that stay in the page.
- **Don't** nest a box inside a box. A list in a panel is rows, not cards;
  a selected row takes the active wash (ink at 6 %), not an outline.
- **Don't** mark state with a pill when a block, the ink, or the weight of
  the text can carry it. One state, one treatment.
- **Don't** build a card from a tinted wash, a coloured border and an icon.
  It reads as a template. Use the decision card's rule instead.

## Open questions

- **Which tone means "waits on the reader"?** The browser app uses solid live
  blue for the reader's turn (`StageStrip`, `DecisionCard`). The watch
  prototype uses full ink. Pick one before the watch work lands.
- **Is "needs" a sixth tone?** If yes, add it to `TallyTone` in
  `ui/src/ui/TallyRow.tsx`.
- **Brand tones and app tones differ.** `docs/brand/README.md` gives the
  mark's red as `#ff645f` and blue as `#4c93ff` on dark. The app's dark bad
  and live tones are the OKLCH values above. Check whether they should match.
