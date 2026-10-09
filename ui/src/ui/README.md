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
