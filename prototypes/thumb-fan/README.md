# Thumb fan — throwaway

**Question it answers:** holding the tablet in one hand, can a press-and-hold
in the transcript put every panel one thumb-flick away, wherever the thumb
happens to land?

**Bet under test:** a *positional* fan — one that opens where you pressed
rather than in a fixed corner — is worth the muscle memory it costs.

Nothing here ships. No build step, no dependencies, outside `tsc` / `eslint` /
`knip` / `vite` scope like the rest of `prototypes/`.

## The four variations

Switch from the header, or `?v=`. They run from most gestural to most explicit.

| | `?v=` | Idea | Buys | Costs |
|---|---|---|---|---|
| **Discs** | `discs` | Icon arc, one name at a time | Fastest to point at; smallest arc | Nothing teaches the order. Five unnameable glyphs |
| **Labels** | `labels` | Same arc, names radiating outward | Nothing to learn — every name is visible | Widest footprint; covers the most transcript |
| **Radial** | `radial` | A real pie menu, full circle | **Directions never move.** Inbox is always west, on every press, in every posture | Needs left and right as well as up and down. Clips near an edge, and cannot be moved to avoid it |
| **Column** | `column` | A list beside the thumb, pure up/down | Familiar metaphor; every name visible; no arc to learn | Looks like software, not a gesture. A row is a band, not a wedge — less forgiving |
| **Knob** | `knob` | Stir to scrub, one detent per 30° | **Unbounded list at a fixed footprint.** Degrades best at edges. A flick with no stir picks Inbox | Slowest for anything far down the list. Thinnest feedback of the five |

The unresolved question they exist to answer: is the arc's speed worth its
opacity, or is a legible list worth looking like a menu?

Radial and Knob sit off that line. Radial is the only variant that can offer
*angular* muscle memory, because a full circle never has to rotate to fit and
so its directions are constant. Knob is the only one whose capacity is not
bounded by the screen, because circular motion has no end — twelve panels is
one turn, twenty-four is two, and the footprint is identical.

### Why Dial became Knob

Dial had the right idea and the dullest possible input: travel a fixed distance
up, arrive at a fixed item. A thumb that can pivot and stir was being asked to
act as a scrollbar, and the list length was capped by how far the thumb could
reach. Knob keeps what Dial was for — one at a time, scrubbed, so the order is
taught rather than memorised — and replaces the input with a stir.

The best property is an accident of the arithmetic: first contact defines zero,
so leaving the dead zone in *any* direction lands on item one. A flick with no
stir at all selects Inbox, which means the most common action is also the
cheapest and only people who want something further down pay for the stir.

The drawn ring is a hint, not a track. Selection reads bearing only, so a lazy
20px stir works exactly as well as a broad one — and it is why Knob survives a
corner press better than anything else here: the only element that must stay on
screen is the name chip.

### Fixes applied to all four

From the critique of the first pass:

- **Resting targets have an edge.** The old resting disc measured 1.25:1
  against the scrim; the shape was invisible and only the selected target read.
  Now the border carries the shape at 3.48:1.
- **The scrim is heavy enough to recede.** At `.45` the transcript stayed fully
  legible behind the surface and competed with it. Now `.72`.
- **The hold is visible.** A ring closes in over exactly `holdMs`. Before this,
  a press that was arming and a press that was ignored were pixel-identical for
  half a second, so anyone who released early learned the gesture was flaky.
- **The dead-zone ring is gone.** It was a circle of target size in the target
  family, sitting in the arc — it read as a sixth, empty target.
- **One accent at a time.** The caption is a quiet chip; the selected target is
  the only accent-filled object.
- **On-system motion.** Two durations (120/220ms), one curve, and a
  `prefers-reduced-motion` block. Previously three ad-hoc durations and none.
- **Badge contrast.** White on the old badge measured 3.80:1. Now 6.36:1.

Still open, and deliberately not fixed here: there is **no keyboard path and no
ARIA**, so the gesture is unusable by assistive tech. That is only defensible
if the shipped design pairs it with a visible, focusable rail.

## Run it

```bash
cd prototypes
nix shell nixpkgs#nodejs_22 -c node serve.mjs . 8600 0.0.0.0
```

Then <http://zao:8600/thumb-fan/> on the tablet. Press and hold anywhere in the
transcript, slide, release. `settings` at the bottom-left opens the sliders.

Two checks, neither of which needs the tablet:

```bash
cd prototypes/thumb-fan
nix shell nixpkgs#nodejs_22 -c node check-fan.mjs                     # geometry
nix shell nixpkgs#nodejs_22 -c node check-fan.mjs --shift-sweep       # tuning table
nix shell nixpkgs#nodejs_22 -c node check-fan.mjs --radial-sweep      # radial clipping cost
nix shell nixpkgs#nodejs_22 -c node check-contrast.mjs                # colour floors
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node capture-fan.mjs  # pixels, all variants
```

## Why it copies numbers instead of choosing them

The hold is 500 ms with a 10 px tolerance because that is `ROW_PRESS` in
`src/client/src/rowPress.ts` — already used by the inbox row menu, and already
the delay `panelPeekController` disarms on (`PEEK_STILL_MS`). The peek gesture
therefore steps aside for this press today, without giving anything up.

## What the fan does

| Decision | Rule |
|---|---|
| Where it opens | **Left of** the press point, so choosing is an up-and-down motion for a right hand and the discs clear the hand. Only a thumb too close to the left edge turns it |
| How far left | `shift` — the fan's centre moves along **the bearing the arc actually opened on**, not a fixed one. The dead zone stays on the finger |
| When it cannot fit | The radius **grows**. A larger circle sees a wider run of on-screen bearings and needs fewer degrees per target |
| Target order | Ordinal, not angular. Target 1 is always the end nearest the bottom — the shortest thumb travel — whichever way the arc rotated |
| How you choose | By **bearing**, not distance. Point at a target; you do not have to reach it |
| Naming | One chip names the hovered target, just outside its disc. Names are not on the arc, and not beside the thumb — that space is under the reader's own hand |

The side is a setting (`opens`: left / right / away from edge). Left is the
default because the hand this is for is a right one.

## What the checks found

`check-fan.mjs` sweeps 274,205 press points across five viewports. Four defects
were only visible from it, not from looking at the screen:

1. **Crowding in corners.** The first layout crammed the targets into whatever
   arc was left. 15,324 press points produced overlapping discs.
2. **The wrap seam.** A run spanning 293°→362° was cut into two fragments at
   0°, and a bottom-left press chose a 2° sliver over the 69° arc beside it.
3. **Footprint understated.** Geometry used a 26 px target radius while the
   drawn target was 52 px wide with a label under it. Corner captures lost the
   word "Inbox" off the bottom edge.
4. **Names do not fit.** With honest footprints, names on the arc dropped the
   cover screen to three targets. Moving to a single chip on the hovered target
   restored five, and is the better design regardless — nobody reads five names
   during a gesture.

`capture-fan.mjs` found a fifth, which no still photograph could show:

5. **The fan blinked between targets.** Every hover change rebuilt the fan's
   elements, which replayed their staggered entry animation, and
   `animation-fill-mode: both` holds a target at zero opacity through its
   delay. The whole fan vanished and popped back every few pixels of travel.
   Nothing was wrong with the selection. Mounting once and toggling classes
   fixed it, and the capture now sweeps the arc twice and asserts the count:

   ```
   5 targets, 0 element rebuilds / 18 caption text swaps over 240 moves
   ```

   Zero is the number that matters. The rest are names legitimately changing as
   the finger crosses between targets.

Building the variations found a sixth:

6. **Pills cannot sit on a circular arc.** Named pills laid on the disc arc
   overlapped at cover-screen size, and no spacing value fixed it: on a circle,
   equal angles give unequal *vertical* separation, so the ends of the arc
   always flatten into the axis a wide box is widest in. Labels now keeps the
   disc arc and pushes names onto a wider circle, where the same angle covers
   more distance.

## The chosen slot map

Eight slots at 45°. Seven panels and an overflow.

| Slot | Panel | Why |
|---|---|---|
| W | **Inbox** | Most used. A straight-left flick, no diagonal |
| NW | Files | `order: 10` |
| N | Git | `order: 20` |
| NE | Terminal | `order: 30` |
| E | Processes | `order: 50` |
| SE | Tasks | `order: 40` |
| S | Notifications | `order: 40`. Reserved — dark until something arrives |
| SW | **More…** | Agents, Relays, Info, Updates |

Order comes from the panels' own `order` values rather than taste. Agents sits
behind More because `plugins/core/panels.ts:55` calls it "the least-reached-for
tool" — the codebase had already made that judgement.

Most-used sits in the **upper half** deliberately. The lower wedges are doubly
disadvantaged: they point toward the palm, and they are the half that clips
when the thumb is near the bottom corner. Putting More and the rare panels
there aligns both costs with the least-used items.

### Reserved slots, and why re-packing is banned

Two panels are conditionally visible in the real app:

```
notifications  visible: (context) => notificationCount(context) > 0 || isOpenTool(...)
agents         visible: (context) => agentsWorking(context).total > 0 || isOpenTool(...)
```

A wheel with fixed directions cannot let a panel's absence close its gap,
because closing the gap rotates every direction after it. So an absent panel
keeps its wedge and goes dark: the bearing stays learnable, the hub names it
and qualifies it (`Alerts · none`), and releasing on it is a no-op.

The same rule is what makes growth safe. **The slot map must be stored, not
derived.** `plugins/registry.ts:82` sorts panels by `order ?? 1000` then title,
so a plugin registering at `order: 15` would insert between Files and Git and
silently re-teach every direction on install. Persist `slot → panel id`; a new
panel takes the next free slot; a removed panel leaves a hole.

### Not in the MVP

| Excluded | Why |
|---|---|
| Configurable wedge count | Changing N moves every direction |
| User-reorderable slots | Same, unless gated behind an explicit warning |
| Left-hand mirroring | The `side` anchor flips W→E and rotates all eight. A one-time setup choice, never a toggle |
| Submenus on wedges | More… is a sheet, not a nested wheel |

## What Radial costs, measured

Radial refuses to move its centre — every bearing is taken from the finger, and
moving the centre would change all of them, which is the one thing the variant
exists to prevent. So clipping is a permanent property, not a bug, and the only
honest response is to measure it. `--radial-sweep`:

```
count  wedge   icons: unfold-P  unfold-L  fold-P  fold-L  tab   worst
    4    90°        81%       79%       75%       70%       86%     0/4
    8    45°        81%       79%       75%       70%       86%     1/8
   12    30°        81%       79%       75%       70%       86%     2/12
```

The surprise is that **the count is nearly free**. Coverage depends on whether
the wheel fits at all, not on how finely it is divided, so eight wedges cost no
more of the screen than four. The limit on N is human memory, not pixels. For
scale, a 45° wedge is about three times as forgiving as the 16° pointing gap
the arc variants already demanded.

What does not improve with count is the corner: roughly one thumb-zone press in
four hides at least one icon, and a hard corner press shows one of eight.
Selection still works there — a bearing does not need to be visible to be
flicked toward — so **clipping is a learning cost, not an operating cost**.
That is only true if learning happens somewhere else, which is the strongest
argument for pairing the wheel with a visible rail rather than shipping it
alone.

Three adjustments are deliberately refused, because each would trade away the
premise: moving the centre changes every bearing; sliding an icon sideways
points it at a wedge it is not; pushing an icon into the hub makes it read as a
mistake. The only legal move is walking an icon inward along its own ray, and
when even that runs out the icon is dropped rather than drawn wrong.

Current state, with the disc scaled from the shorter viewport side:

```
  ok    fold unfolded portrait   704×783    7 targets  52px disc  16° tightest
  ok    fold unfolded landscape  932×553    6 targets  52px disc  16° tightest
  ok    fold folded portrait     475×638    6 targets  52px disc  16° tightest
  ok    fold folded landscape    711×374    5 targets  45px disc  16° tightest
  ok    tab-ultra (unmeasured)   1280×800   7 targets  52px disc  16° tightest
```

The gate is five. The cover screen in landscape is the binding posture and has
no headroom; a sixth panel would have to come from somewhere else there.

## Choosing `shift`

`node check-fan.mjs --shift-sweep` reports what each value costs, so the number
comes from a table rather than from guesses:

```
shift  clearance  tightest  applied  interior  thumb zone  seats 5
   0px      70px       17°       0%        0%          0%  yes
   8px      70px       16°      99%       98%        100%  yes   <- default
  24px      70px       16°      94%       92%         98%  yes
  40px      70px       16°      89%       88%         97%  yes
  64px      70px       16°      82%       82%         94%  yes
  88px      70px       16°      69%       80%         87%  yes
```

- **clearance** — nearest disc edge to the press point, worst case. Flat,
  because a shift that would bring a disc closer to the hand than a centred fan
  is discarded for that press.
- **tightest** — smallest angle the thumb must resolve two neighbours in. Also
  flat: the shift is close to free here, which contradicts the earlier guess
  that it would halve the pointing angle.
- **applied** — share of presses that keep the shift. This is the real cost. A
  shift that vanishes on some presses makes the gesture feel inconsistent, and
  that is worse than never shifting.

The shift follows the arc's own bearing for this reason. Shifting along a fixed
bearing dropped a quarter of thumb-zone presses, because near the bottom edge
the arc tilts upward while the shift still went left and the far end of the fan
swung back over the hand.

## What the checks cannot answer

Everything that needs a hand:

- Is the arc inside your thumb's reach, or 15 mm outside it? Move the **radius**
  slider until pointing is effortless, then read the number.
- Is ordinal memory good enough? Press repeatedly in different places and see
  whether "first one going up" ever becomes automatic. If it does not, the
  positional choice was wrong and an anchored fan is the answer.
- **Text selection.** The transcript is a copy surface, and a long press on
  selectable text raises the platform callout. `press zone` and
  `block text selection` in the settings give the four combinations. Both
  losses are real; the prototype only shows you which you mind less.
- 500 ms: too slow to feel instant, too fast to avoid triggering by accident?
  The `hold` slider moves it. Changing it means changing `ROW_PRESS`, which the
  inbox row menu also presses with.

## Not tested here

- Mouse and keyboard paths. The fan is touch-only by design; it is an
  accelerator on top of a visible rail, not a replacement for one.
- Landing on the real panels. Targets are labels, and selecting one writes a
  line to the readout.
- Whether the inbox belongs in the same set as the inspection panels at all.
  That is the open design question this gesture assumes an answer to.
