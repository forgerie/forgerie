# System components

The shared space of the browser app. Every component here holds a reusable
decision and names no Forgerie concept. Search this list before you build a
component. If what you need is missing and its structure is generic, add it
here at its first call site, with its part and one line below.
[Decomposition](../../docs/decomposition.md) has the rules.

One line per component: the name in backticks, its layer, and what it decides.

- `CopyButton` (molecule): copies text on press and reports the result in a live region.
- `EventLine` (molecule): one quiet line for something that happened, with a tone dot, a time, an always-visible quote, and details on request.
- `AlertCard` (molecule): a failure that may need the reader: title, explanation, code, actions, and an output panel the actions fill.
- `MarkdownFragment` (atom): renders a short piece of Markdown inside a block, under the reply's link and image policy, with no outer margin.
- `Checklist` (molecule): shows progress on a list of tasks from `[x]`/`[~]`/`[ ]`/`[!]`/`[-]` lines, with an in-order meter and a count.
- `FileTree` (molecule): shows the files a change touched as a tree, marked added, changed or deleted, with single-child directories folded.
- `FactList` (molecule): shows a few headline values from `Label: value` lines; cells share a row and wrap by container width.
- `Diagram` (molecule): draws Mermaid source once it stops changing, keeps a readable scale by scrolling, and shows the source when it cannot draw.
- `ClaimList` (molecule): shows findings tagged verified, inferred, opinion or unknown, with a text label and evidence under each.
- `Disclosure` (molecule): hides supporting material behind a one-line summary, closed by default and uncontrolled so it stays open while text streams.
- `CommandList` (molecule): lists shell commands to run in order, each with a note and its own copy button, plus copy all.
- `BarChart` (molecule): draws a few numbers of one kind as bars from zero, with each value also stated as text.
