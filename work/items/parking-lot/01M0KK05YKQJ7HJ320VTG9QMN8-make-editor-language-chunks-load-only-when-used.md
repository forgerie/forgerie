---
id: 01M0KK05YKQJ7HJ320VTG9QMN8
slug: make-editor-language-chunks-load-only-when-used
title: Make editor language chunks load only when used
origin: parked
status: To Do
priority: medium
labels:
  - performance
  - frontend
  - bundling
created: 2026-08-22
source: se-work
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
  invoked_by: rich-code-block-composer
---

# Make editor language chunks load only when used

## Why it matters

Vite's manual chunk groups every `@codemirror/lang-*` module into one preloaded 330 KB raw chunk, so the composer cannot defer uncommon grammars despite using dynamic imports. Fixing this can reduce startup transfer and evaluation cost, but it changes chunking for CodeViewer and should remain separate from rich code-block editing.

## Acceptance Criteria

- [ ] The built page does not module-preload the full editor-language chunk.
- [ ] Opening a supported fenced language loads only the required language chunk or a justified small group.
- [ ] Composer and CodeViewer language coverage and syntax highlighting tests stay green.
- [ ] Production build output documents the before-and-after initial transfer cost.

## Related

- `vite.config.ts`
- `src/client/src/components/composerCodeLanguages.ts`
- `src/client/src/components/CodeViewer.ts`
