# UI source and licenses

The chat presentation adapts the actual [assistant-ui homepage demo](https://github.com/assistant-ui/assistant-ui/tree/dabe34fca8a31bf7f8afac89827bf3bf683942e6/apps/docs/components/pages/home/demo), reviewed at commit `dabe34fca8a31bf7f8afac89827bf3bf683942e6`.

| Source in assistant-ui | Adaptation here |
| --- | --- |
| `apps/docs/components/pages/home/demo/thread.tsx` | `src/ui/Thread.tsx` preserves the reading column, message flow, sticky composer, loading state, welcome state, and scroll-to-bottom control. |
| `apps/docs/components/pages/home/demo/messages.tsx` and `action-bar.tsx` | `src/ui/Messages.tsx` preserves right-aligned user bubbles, unboxed assistant replies, and response copying. |
| `apps/docs/components/pages/home/demo/composer.tsx` | `src/ui/Composer.tsx` preserves the textarea, bordered shell, and arrow/stop actions. |
| `apps/docs/components/pages/home/demo/trace.tsx`, `apps/docs/components/shared/trace-line.tsx`, and the grouped-parts switch in `messages.tsx` | `src/ui/Trace.tsx` preserves the trace grammar: one quiet monospace line per step, a `>` marker that rotates when a disclosure opens, running/ran labels with a live shimmer, adjacent tool calls grouped under one line, and reasoning collapsed under a thinking/reasoning line. Native `<details>` replaces the site's Collapsible. The expandable input/output body, failure and stopped states, and the failure count on group lines are Forgerie additions. |
| `apps/docs/components/assistant-ui/elements/markdown-text.tsx` | `src/ui/MarkdownText.tsx` preserves formatted replies and code sheets. It uses assistant-ui's Markdown renderer with GFM. |
| `apps/docs/styles/globals.css` and `apps/docs/app/layout.tsx` | `src/ui/theme.css` preserves the light/dark palette, popover colour, Public Sans, JetBrains Mono, the system display face for headings, and the thread/surface/control/document radii. |
| `apps/docs/components/pages/home/demo/shell.tsx` | `src/ui/SessionFrame.tsx` and `src/ui/AppShell.tsx` preserve the 48 px thread header with a `PanelLeft` opener and the title alone, the tinted 15rem sidebar with `border-r` when docked, and the 18rem Sheet with a black/50 scrim when not. |
| `apps/docs/components/pages/home/demo/sidebar.tsx`, `thread-list-item.tsx`, and `styles.ts` | `src/ui/Picker.tsx` preserves the sidebar header (mark and product name), 12 px section labels, 13 px muted row titles with the hover and active tints, the `MoreHorizontal` row trigger, and the menu panel and item styles with lucide icons. Forgerie rows keep a second 12 px line for the project and live work. |
| `apps/docs/components/assistant-ui/elements/markdown-text.tsx` (code sheet and table) | `src/ui/MarkdownText.tsx` and `src/ui/theme.css` preserve the 36 px tinted code header with an 11 px mono label, the 13 px table, and the `aui-md-*` heading, list, link, and rule spacing. |

This is an adaptation, not a complete copy of the homepage demo. The MVP retains its existing `ExternalStoreRuntime` and Forgerie transport. It omits the sidebar, memory, attachments, models, voice, feedback, regeneration, branches, and suggestions because this client does not implement their contracts. CSS replaces the site's Tailwind classes and Next.js dependencies. Highlight.js replaces Shiki for completed code fences. Unknown code languages remain plain text. Math and diagrams are not rendered.

The content column remains 42rem. Message spacing and page gutters scale with the container. Icon controls are drawn at the demo's sizes (24 to 32 px) and keep a 44 CSS-pixel hit area through an invisible `::before`; acceptance scripts measure it with `scripts/lib/hit.mjs`. Stacked menu items and picker rows stay 44 px tall, because neighbours cannot share an invisible hit area. Response copy controls and the selected row's "⋯" stay visible rather than requiring hover. Both copy actions report clipboard failure. No device-width breakpoints or alternative mobile layout are introduced. The drift audit that led to these values is in [`verification/ui-drift-audit.md`](verification/ui-drift-audit.md).

## assistant-ui

Copyright (c) 2026 AgentbaseAI Inc. Licensed under the MIT License. The full license is included at [`public/licenses/assistant-ui.txt`](public/licenses/assistant-ui.txt), and Vite copies it into the built app at `/licenses/assistant-ui.txt`.

## Fonts

Public Sans and JetBrains Mono are served locally through Fontsource. Their full licenses are included at [`public/licenses/public-sans.txt`](public/licenses/public-sans.txt) and [`public/licenses/jetbrains-mono.txt`](public/licenses/jetbrains-mono.txt). Vite copies both into the built app. No Google Fonts request is needed.

Forgerie's existing MIT attribution remains in `LICENSE`.
