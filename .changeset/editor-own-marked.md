---
"forgerie": patch
---

Give each Markdown editor its own Markdown parser. Before, every editor added its parsing rules to one shared parser for the life of the page. Opening Markdown files then got slower with each file opened, and after a Markdown file with a task list was open, the agent prompt editor read `- [ ] task` lines as one paragraph.
