# System components

The shared space of the browser app. Every component here holds a reusable
decision and names no Forgerie concept. Search this list before you build a
component. If what you need is missing and its structure is generic, add it
here at its first call site, with its part and one line below.
[Decomposition](../../docs/decomposition.md) has the rules.

One line per component: the name in backticks, its layer, and what it decides.

- `TextSubmit` (molecule): one typed value and the action that sends it; the button drops under the field when the row is narrow, and a refused value stays.
- `HeaderButton` (atom): a page header's one filled action, with a control-sized hit area; it can submit a form elsewhere on the page.
- `MenuButton` (molecule): rare commands one tap away behind a ⋯ button, with arrow keys, and a destructive command that asks twice in place.
- `ChoiceList` (molecule): pick any number of rows; the legend counts the choice, a long list gets a search field, and a chosen id with no row stays visible.
- `ListSection` (molecule): a titled list of `<li>` rows on a settings-style page, with an empty text and a note on where the items live.
- `ActionRow` (molecule): a list item that is not a link: name and status on one line, a detail under them, its commands at the end.
- `TitleField` (atom): a document title typed in place, in the title face, with its standfirst under it.
- `Lede` (atom): the one quiet paragraph that opens a page.
- `FilterChip` (atom): a filter that is on, above the list it narrows, with a clear button; not drawn when no filter is on.
- `CopyButton` (molecule): copies text on press and reports the result in a live region.
- `EventLine` (molecule): one quiet line for something that happened, with a tone dot, a time, an always-visible quote, and details on request.
- `AlertCard` (molecule): a failure that may need the reader, drawn as a rail and wash in the failure tone: subject and phrase, explanation, wrapped code, quiet actions or a disclosure, and an output panel the actions fill.
- `MarkdownFragment` (atom): renders a short piece of Markdown inside a block, under the reply's link and image policy, with no outer margin.
- `Checklist` (molecule): shows progress on a list of tasks from `[x]`/`[~]`/`[ ]`/`[!]`/`[-]` lines, with an in-order meter and a count.
- `FileTree` (molecule): shows the files a change touched as a tree, marked added, changed or deleted, with single-child directories folded.
- `FactList` (molecule): shows a few headline values from `Label: value` lines; cells share a row and wrap by container width.
- `TreeItem` (atom): one row of an ARIA tree, indented by level, with a chevron on a branch or a toned mark on a leaf, a count, and a dot.
- `ToggleGroup` (molecule): a few choices of one setting as quiet pressed buttons, each with an optional count and a control-sized hit area; a lead turns the row into a sentence with its choices in one track.
- `FileTile` (atom): one file as a square: a picture fills it and any other file shows its type, the name under it, a note only for what the tile cannot show, and a corner remove.
- `TileStrip` (molecule): one row of tiles that keeps its height and scrolls sideways, one control after the last tile (under them once they fill the row), and each failure in full below.
- `NoticeBar` (molecule): a full-width bar that stops the reader until they choose: a message and its actions, in a plain or alert tone.
- `CodeEditor` (molecule): an editable CodeMirror editor with line numbers, undo, Tab to indent, Ctrl/Cmd+S, and syntax colour from the file name.
- `Diagram` (molecule): draws Mermaid source once it stops changing, keeps a readable scale by scrolling, and shows the source when it cannot draw.
- `ClaimList` (molecule): shows findings tagged verified, inferred, opinion or unknown, with a text label and evidence under each.
- `Disclosure` (molecule): hides supporting material behind a one-line summary, closed by default and uncontrolled so it stays open while text streams.
- `CommandList` (molecule): lists shell commands to run in order, each with a note and its own copy button, plus copy all.
- `BarChart` (molecule): draws a few numbers of one kind as bars from zero, with each value also stated as text.
- `CorrectionPanel` (molecule): states a correction loudly: the earlier claim struck through, the correct one strong, and the cause.
- `AsideList` (molecule): lists findings outside the question, each with a high, medium or low pill that reads without colour.
- `RailSection` (molecule): supporting content set smaller and muted on a hairline, optionally closed by a labelled rule that leads into the main text.
- `TallyRow` (molecule): content with one toned mark per unit of work in its margin; the marks open a panel, and a long tally ends in a count that keeps the worst tone it hides.
- `Timeline` (molecule): shows events in order with their times in one aligned column, joined by a rail.
- `QuoteFigure` (molecule): shows a quotation with its source as a caption in the code face.
- `Figure` (atom): one short figure (a share, a clock, an amount) in the code face with tabular digits, toned plain, muted, warn, bad or faint.
- `SignalDot` (atom): a yes-or-no signal with no level, neutral when on and danger when off.
- `PaceBar` (atom): a budget's share left against an even spend: a cut at pace, a hatch for a shortfall, a warn-to-danger bar for a surplus.
- `ErrorBoundary` (atom): replaces children that throw while drawing with a fallback, so everything around them keeps working.
- `LaneGrid` (molecule): named groups of measurement lanes on one set of columns, each group named by text or an icon, with optional captions, a marked block, trailing cells that span rows, and a small action chip per block.
- `Consequence` (molecule): one consequence the reader must see before acting, set apart by a wash and an icon, plain or warn.
- `FloatingPanel` (atom): the surface of a window-level panel that scrolls inside the height it gets; its host places it, and it sits inside the window edges until then.
- `OptionRow` (atom): one choice as a button: a name, a variant, a leading mark, short details (a path gives way at its start), and a check on the choice in effect.
- `OptionList` (molecule): choices in named groups with search, one status line and a foot command; rows take focus, or follow a text field's highlight.
- `Shelf` (organism): a section at the foot of a list that opens and closes from a group header (closed, the header alone), scrolls on its own, and reports the room it sits in.
- `BadgeButton` (atom): an icon button drawn small with a control-sized hit area, a live-colour count of what waits on the reader, and a working dot.
- `SheetDialog` (organism): a modal sheet that is a card while the window has room and meets each edge as the room runs out, with back, title, actions, close, a scrolling body, and a footer.
- `StatusRow` (molecule): one pressable row for a running thing: a tone dot, a name, a detail, and a status that wraps under the name when the row is narrow.
- `ExchangeLog` (molecule): one worker's record, oldest first: words with the speaker in a margin, one line per action, and folded output.
- `ReplyBox` (molecule): a short text field with send and an optional second action; Enter sends and the text stays until the send succeeds.
- `QuestionCard` (molecule): a question that waits on the reader, with a reply box while open and the answer once given.
- `Glyph` (atom): a one-colour mark from an SVG path on a 24-unit grid, at the size and colour of the text beside it.
- `Toast` (molecule): a short message that does not stop the reader: the message at full width with dismiss in its corner, and a foot row with the detail's first words (cut, they open the whole text) and one action; it always shows in the page's `ToastRegion`.
- `ToastRegion` (organism): the one place toasts appear, at the window's top end under the header, above the sheet and the thread; mounted once at the entry.
