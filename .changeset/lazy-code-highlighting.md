---
"forgerie": patch
---

Load the code highlighter only when a finished code block first needs it, so the app's first load is smaller. Code shows as readable plain text until the colours arrive, every language and alias still highlights, and a selection you make inside a code block is kept while the colours load.
