# System components

The shared space of the browser app. Every component here holds a reusable
decision and names no Forgerie concept. Search this list before you build a
component. If what you need is missing and its structure is generic, add it
here at its first call site, with its part and one line below.
[Decomposition](../../docs/decomposition.md) has the rules.

One line per component: the name in backticks, its layer, and what it decides.

- `TextSubmit` (molecule): keeps a text entry and its submit action together through reflow and retries.
- `ActionButton` (molecule): exposes a labeled action with a full-size hit target.
- `ActionCard` (molecule): keeps an item's identity, status and actions together as it reflows.
- `ChoiceSelect` (molecule): combines a labeled choice with an optional management action.
- `DialogPanel` (organism): opens window-level content with a reachable close action and a scroll region.
- `CollectionEditor` (organism): edits named selections without losing an unsaved draft on a refused write.
- `CopyButton` (molecule): copies text on press and reports the result in a live region.
- `EventLine` (molecule): one quiet line for something that happened, with a tone dot, a time, an always-visible quote, and details on request.
- `AlertCard` (molecule): a failure that may need the reader: title, explanation, code, actions, and an output panel the actions fill.
- `MarkdownFragment` (atom): renders a short piece of Markdown inside a block, under the reply's link and image policy, with no outer margin.
- `Checklist` (molecule): shows progress on a list of tasks from `[x]`/`[~]`/`[ ]`/`[!]`/`[-]` lines, with an in-order meter and a count.
- `FileTree` (molecule): shows the files a change touched as a tree, marked added, changed or deleted, with single-child directories folded.
- `FactList` (molecule): shows a few headline values from `Label: value` lines; cells share a row and wrap by container width.
- `TreeItem` (atom): one row of an ARIA tree, indented by level, with a chevron on a branch or a toned mark on a leaf, a count, and a dot.
- `ToggleGroup` (molecule): a few choices of one setting as quiet pressed buttons, each with an optional count and a control-sized hit area.
- `NoticeBar` (molecule): a full-width bar that stops the reader until they choose: a message and its actions, in a plain or alert tone.
- `CodeEditor` (molecule): an editable CodeMirror editor with line numbers, undo, Tab to indent, Ctrl/Cmd+S, and syntax colour from the file name.
- `Diagram` (molecule): draws Mermaid source once it stops changing, keeps a readable scale by scrolling, and shows the source when it cannot draw.
- `ClaimList` (molecule): shows findings tagged verified, inferred, opinion or unknown, with a text label and evidence under each.
- `Disclosure` (molecule): hides supporting material behind a one-line summary, closed by default and uncontrolled so it stays open while text streams.
- `CommandList` (molecule): lists shell commands to run in order, each with a note and its own copy button, plus copy all.
- `BarChart` (molecule): draws a few numbers of one kind as bars from zero, with each value also stated as text.
- `CorrectionPanel` (molecule): states a correction loudly: the earlier claim struck through, the correct one strong, and the cause.
- `AsideList` (molecule): lists findings outside the question, each with a high, medium or low pill that reads without colour.
- `Timeline` (molecule): shows events in order with their times in one aligned column, joined by a rail.
- `QuoteFigure` (molecule): shows a quotation with its source as a caption in the code face.
- `Figure` (atom): one short figure (a share, a clock, an amount) in the code face with tabular digits, toned plain, muted, warn, bad or faint.
- `SignalDot` (atom): a yes-or-no signal with no level, neutral when on and danger when off.
- `PaceBar` (atom): a budget's share left against an even spend: a cut at pace, a hatch for a shortfall, a warn-to-danger bar for a surplus.
- `ErrorBoundary` (atom): replaces children that throw while drawing with a fallback, so everything around them keeps working.
- `LaneGrid` (molecule): named groups of measurement lanes on one set of columns, with optional captions, a marked block, and trailing cells that span rows.
- `Shelf` (organism): a section at the foot of a list that switches between two forms from a group header, scrolls on its own, and reports the room it sits in.
- `BadgeButton` (atom): an icon button drawn small with a control-sized hit area, a live-colour count of what waits on the reader, and a working dot.
- `SheetDialog` (organism): a modal sheet that is a card while the window has room and meets each edge as the room runs out, with back, title, actions, close, a scrolling body, and a footer.
- `StatusRow` (molecule): one pressable row for a running thing: a tone dot, a name, a detail, and a status that wraps under the name when the row is narrow.
- `ExchangeLog` (molecule): one worker's record, oldest first: words with the speaker in a margin, one line per action, and folded output.
- `ReplyBox` (molecule): a short text field with send and an optional second action; Enter sends and the text stays until the send succeeds.
- `QuestionCard` (molecule): a question that waits on the reader, with a reply box while open and the answer once given.
