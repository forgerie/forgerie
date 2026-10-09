# Composer rich editing

The composer input is now a CodeMirror editor, as it was in the legacy client. A complete code fence reads as a highlighted code block. The editor's own keys, undo history, and Markdown list commands are back. The draft stays canonical fenced Markdown: drafts, recall, queueing, and sending see the same text as before.

This applies to the chat composer, ask and extension-input answers, and the new-session dialog. They share `src/ui/ComposerEditor.tsx`.

## Behavior

| Input | Result |
| --- | --- |
| Type ` ```sql `, then Shift+Enter (Enter in a new session) | The fence closes. The caret moves to the first code line. One undo restores ` ```sql `. |
| A complete fence, typed, pasted, recalled, or set by the composer | The fence lines hide behind a label and a closing edge. The label is the tag as written, such as `sql` or `ts`. |
| A tag that names a language | The block uses the same five code colours as transcript code and diffs, for every tag the editor carries a grammar for. Grammars load on first use. A tag with no editor grammar, such as `nix`, or one no grammar knows, such as `diagram`, stays plain but keeps its label. |
| An incomplete fence | Stays visible as source. |
| Shift+Enter inside a block | Adds a code line. |
| Arrow Down on a block's last line | Moves past the hidden closing fence into prose, or into the next block. |
| Backspace at a block's first line, Delete at its last | Do nothing, so a hidden fence cannot be deleted by accident. |
| An empty block | Its body is a button. Click it, or press Enter or Space on it, to get a code line. |
| A long code line | Scrolls inside the block. The page does not scroll sideways. The caret stays in view. |
| Tab, Shift+Tab | Indent and outdent by two spaces. An open suggestion list takes Tab first. |
| Ctrl+M; or, with text in the draft, Escape and then Tab within 2 seconds | Tab moves focus out of the editor instead of indenting. In an empty draft, the bar takes Escape for Stop and double Escape, so use Ctrl+M there. |
| Shift+Enter on a list item or quote | Continues the list or quote. |
| Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z | Undo and redo through the editor history. |
| CodeMirror's `defaultKeymap` and `historyKeymap` | Installed in the same order as in the legacy editor, after the bar's keys. Only the commands in this table have tests. As in the legacy editor, multiple selections are off, so the add-cursor commands do nothing. |
| Up and Down history recall | Use the legacy rule again: a draft leaves for history only from its start. A recalled prompt leaves from its first or last drawn line. |
| Files pasted into the editor | Become attachments. Dropped files go to the bar's drop zone, not into the text. |

Every key the bar claims still runs first: Enter routing, queue and steer, suggestions, recall, Escape, and the Android modifier repair in `useComposerKeyboard.ts`.

## How it is built

- `ComposerEditor.tsx` binds CodeMirror to the assistant-ui composer. Edits go to the composer. Changes from the composer, such as recall, suggestions, dictation, and restored drafts, come back as editor changes, so the caret and undo history follow them.
- The editor's content element is the `ComposerInputElement`. It has `value`, a selection, `setSelectionRange`, `select`, and the editor commands that a textarea does not have. The bar, the tests, and the browser checks use it through `[data-composer-input]`.
- `composerCodeBlock.ts` is ported from the legacy `components/composerCodeBlock.ts`. Two changes: the body wraps only the code lines, and the hidden fences are inclusive at their start, so no empty line shows above the label or the closing edge.
- `composerCodeLanguage.ts` calls a tag a code block only when the same highlight.js instance the transcript highlights with knows it (`codeGrammars.ts`, the full build). `@codemirror/language-data` supplies the editor's grammars, and it carries fewer languages than highlight.js does, so a `nix` draft is plain where the transcript colours it.
- `codeTokens.ts` maps syntax tags to the theme's code colours. The diff editor uses the same map.

## Costs and limits

| Cost or limit | Detail |
| --- | --- |
| Bundle size | The main chunk grew from 1,718,880 to 2,090,695 bytes, and from 528,340 to 648,517 bytes gzipped. CodeMirror's core now loads with every page. The diff editor used to load it on demand. |
| Bundle size, second cost | The transcript moved to the full highlight.js build (193 languages, against 36 in the `common` subset) so that a fence label colours whenever a grammar exists for it. The main chunk grew again: from 2,279,519 to 3,094,668 bytes, and from 711,139 to 970,903 bytes gzipped. |
| Editor grammar coverage | The editor carries 143 grammars. A tag highlight.js knows and the editor does not, such as `nix`, `elixir`, `matlab`, or `nim`, colours in the transcript and draws as labelled plain code in a draft. |
| Late list commands | lang-markdown brings HTML, CSS, and JavaScript grammars. It loads after the bar draws. Until it loads, Shift+Enter on a list item adds a plain newline. |
| A fence at the very end | With the closing fence as the last line, a caret placed after it by pointer sits on the fence line. Typing there turns the block back into source. Arrow Down adds a line first, as in the legacy editor. |
| Undo after a composer change | Composer-side changes are in the undo history. Ctrl+Z after sending can bring the sent text back into the draft. The legacy editor behaved the same way. |
| Ask answer limit | Typing stops at 4,000 characters. Text from outside the editor, such as dictation, can pass the limit, and the answer then cannot be sent until shortened. |
| Dictation | Still appends to the draft through the SDK. It does not replace the selection in one undoable step, as the legacy editor did. |
| Test environment | happy-dom fires `selectionchange` inside selection calls, which re-enters CodeMirror. `src/testSetup.ts` drops that event in unit tests. Browser checks keep it. |
| Physical device | Android Chrome runs CodeMirror's EditContext and IME paths. No ADB device was attached, so IME, hardware keyboard, touch selection, and screen readers on the Fold are unverified. |

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Build, TypeScript, ESLint, and 970 tests in 99 files pass. |
| `src/ui/ComposerEditor.test.tsx` | 19 tests. The 12 legacy `ComposerDraft.codeBlock.test.ts` cases are ported, plus Tab, list continuation, undo and redo, the answer limit, caret placement, and pasted files. Labels are now lowercase. |
| `scripts/composer-rich-acceptance.mjs` | 12 combinations pass with real Chromium key input: the four Fold postures, a 475 × 280 pane, and a 280 × 500 pane, in both themes. Each checks fence completion, undo and redo, highlighting, in-block scrolling, Arrow Down, fence protection, list continuation, Tab, and Escape then Tab. Enter sends the Markdown and the transcript draws it. No API request or page error. |
| Existing fixture checks | Keyboard 12 plus tree 12, queue 60, tree 60, mentions 24, ask, dialogs 60, shell 36, new session 42, compaction 72, model 70, skills 40, slash, streamdown, dictation, and visual pass. |
| Visual review | Read: chat captures at dark folded portrait, light unfolded landscape, dark narrow pane, light folded landscape, light short pane, and dark unfolded portrait; new-session captures at dark folded portrait and landscape, and light unfolded portrait and landscape. |

One queue run of five failed by 1.8 px: in the 475 × 280 pane, Add attachment sat below the window 120 ms after a resize. The next four runs passed. Treat this as a resize-settling risk, not as proven fixed.

Repeat the browser check against the Vite preview with:

```sh
nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/composer-rich-acceptance.mjs
```
