# UI drift audit against the assistant-ui homepage

Checked on 2026-09-30. The reference is the homepage demo source at
assistant-ui `main` (`90f47502f`). The demo files are unchanged since
`dabe34fca`, the commit that `96ec1053` adapted, so the drift is ours, not
upstream's. Reference files: `apps/docs/components/pages/home/demo/{shell,thread,messages,composer,action-bar,trace,sidebar,thread-list-item,styles}.tsx`,
`apps/docs/components/shared/trace-line.tsx`,
`apps/docs/components/assistant-ui/elements/markdown-text.tsx`, and
`apps/docs/styles/globals.css`. The live homepage was also captured with its
demo in full screen at 1280 × 860 and at the four Fold postures.

## Cause

The palette, fonts, radius tokens, user bubble, and 42rem column match the
homepage. The drift comes from four choices made after that:

1. Every icon control was drawn at 44 × 44 px. The homepage draws them at
   28 px (`size-7`) or 24 px (`p-1` around a 16 px icon). The 44 px rule came
   from our own acceptance scripts, not from AGENTS.md or the user.
2. The first adaptation left out the homepage shell (sidebar, sidebar header,
   thread header). The picker was then styled from Forgerie's own prototype,
   not from the homepage sidebar.
3. The ask layer and the picker added their own type sizes, colours, and menus.
4. The thread header kept a "Forgerie / title" breadcrumb that the homepage
   does not have.

## Drift by category

| Category | Surface | Current | Homepage | Fix |
|---|---|---|---|---|
| Chrome | Thread header | Custom hamburger in a 44 px box, then "Forgerie / title". | `PanelLeft` in a 28 px button, then the thread title only (13 px, medium). | Use `PanelLeft` in a 28 px button. Show the title only. The product name moves to the picker header. |
| Chrome | Picker header | "Sessions by state ▾", a 44 px "⋯", and a 44 px "×". | 48 px sidebar header: logo, "assistant-ui" (13 px, medium), and a 28 px collapse button. Tinted with foreground at 2.5 % (4 % dark). | Anvil mark and "Forgerie", then a 28 px "⋯" and a 28 px close. Grouping moves into the "⋯" menu, so changing it still takes two taps. |
| Chrome | Sheet | Width `min(28rem, 100% - 3rem)` (427 px folded). Scrim is foreground at 22 %, a grey wash in dark mode. | shadcn Sheet, 18rem wide, `bg-black/50` scrim, `shadow-lg`. | 18rem sheet, black 50 % scrim, shadcn shadow. |
| Chrome | Docked sidebar | `clamp(17rem, 30%, 23rem)`, page background. | 15rem, tinted background, `border-r` at foreground 10 %. | `clamp(15rem, 22%, 18rem)` and the homepage tint. Rows carry more than a title, so the width may grow a little. |
| Typography | Picker rows | Title 15 px medium. Project 13 px. Time 12.5 px mono. | Row title 13 px, muted, foreground when active. | Title 13 px, project 12 px, time 11 px mono (the homepage meta size). |
| Typography | Picker group labels | 13 px with a "▾" glyph and a mono count. | 12 px medium, muted, no glyph. "Archived (n)" uses a 12 px lucide chevron. | 12 px medium, lucide chevron, plain count. |
| Typography | Ask layer | Question 16 px semibold. "1 of 3" in 13 px. Buttons 15 px. | Body 15 px. Meta counts 11 px mono (branch picker "1 / 3"). Text buttons 13 px medium. | Question 15 px medium. Count 11 px mono. Skip and Next 13 px. |
| Typography | Greeting | Public Sans 500, `clamp(1.5rem, 3.5cqi, 2rem)`. | `font-display` (system UI) 550, 1.5rem, tracking -0.01em. | Match. |
| Typography | Code sheet header | 12.5 px mono label, 44 px tall. | 11 px mono label, 36 px tall, tinted. | Match. |
| Spacing | Composer | Input at least 48 px, then a 44 px button row: about 100 px. | Input `pt-3 pb-2`, 24 px line, then a 28 px button row with `pb-2`: about 80 px. | Match. |
| Spacing | Message actions | Copy icon inside a 44 px box, indented 14 px from the text edge. | `mt-2`, `p-1` around a 16 px icon, aligned with the text. | Match. |
| Spacing | Trace lines | At least 32 px each, centred. | `my-1`, baseline aligned: about 24 px each. | 28 px. Disclosures stay touch targets, so they do not shrink to 24 px. |
| Spacing | Picker list | 4 px row inset, rows about 60 px. | `p-3` panel, `px-2` rows, 32 px rows, `gap-0.5`. | 12 px panel inset, 8 px row padding, 44 px two-line rows, 2 px gap. |
| Colours | Ask step rail | Current step in the live blue. | Blue marks only live work (trace marker). | Current step foreground, answered muted, pending foreground at 10 %. |
| Colours | Picker rows | Selected row `--muted`; titles always foreground. | Active row foreground at 6 %, hover 4 %. Titles muted until active or hovered. | Superseded 2026-10-07: titles at foreground 82 % at rest. See "Picker tiers" below. |
| Colours | Live blue | `#2563eb` light, `#60a5fa` dark. | `text-blue-500` in both themes. | Use blue-500. |
| Radius | Menus | 8 px panel, 6 px items, 25 % border, custom shadow. | `rounded-surface` 10 px panel, 6 px items, 10 % border, popover background. | Match. |
| Density | All icon buttons | 44 × 44 px drawn. | 24 to 32 px drawn. | Draw at homepage size. Keep a 44 px hit area with an invisible `::before`. |
| Density | Composer send | 44 px grey square. | 28 px `bg-primary`, 8 px radius. | Match, with a 44 px hit area. |
| Density | Scroll to bottom | 44 px. | 32 px bordered. | Match, with a 44 px hit area. |
| Message layout | Row menu items | 44 px, text only. | 13 px items with 14 px lucide icons. | Add the icons and use 13 px. Items stay 44 px tall, because stacked items cannot share an invisible hit area. |

## Deliberate differences that remain

- **Hit areas.** Every control keeps a 44 × 44 px hit area on the Fold's touch
  screen. It is invisible, so the drawn size matches the homepage.
- **No hover-only controls.** The homepage shows response actions and row
  "⋯" on hover. On touch there is no hover, so the response copy stays
  visible, and a row's "⋯" shows when the row is selected or focused.
- **Two-line picker rows.** Homepage rows show a title only. Forgerie rows
  also carry the project, the age, and live work counts (agreed in picker
  slice 1), so they are 44 px instead of 32 px.
- **Picker tiers (2026-10-07).** The user could not tell the picker's items
  apart. A second muted line under a muted title, and a muted 12 px group
  label, gave three items one look: "Pinned 11" read as a project name and
  "Show all 11" read as a session. The picker now keeps three distinct tiers.
  Group labels are 12 px semibold with a rule to the edge. Titles are 13 px at
  foreground 82 % at rest. The second line is 11 px muted. Unread and waiting
  titles step up to full foreground and semibold. The pinned cap reads
  "Show 8 more" in 12 px with a trailing chevron. Rows under the Pinned label
  no longer draw a pin. The Backlog count sits in a chip beside its name,
  because at the button's far edge it read as Settings' number. Captures:
  `scripts/picker-shots.mjs` (read-only), all four postures, docked, both
  schemes.
- **Stacked menu items stay 44 px.**
- **No Tailwind.** The homepage classes are translated into `theme.css`
  values. Tests and acceptance scripts find elements by semantic class names
  such as `.picker-row` and `.composer-input`. A Tailwind port would change
  every one of those hooks without any visible gain. The drift came from
  chosen values, not from the translation.
