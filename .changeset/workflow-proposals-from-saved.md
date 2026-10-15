---
"forgerie": minor
---

Workflow proposals now start from your saved workflows. Before it proposes, the agent reads them with `saved_workflows`, adapts the closest one with this task's instructions, and says on the card which one it is based on and what it changed, or why it wrote a new plan. Its guidance asks for the fewest workers, parallel work where possible, and no chained stages without a reason.

A proposal also offers **Do it here**: the agent follows the plan itself in the chat, without workers.

A worker put back on its default model now runs on its agent file's model, not the session's. The model picker names that default, such as "reviewer's model". `child_agent` tells the agent to leave `model` out unless you asked for one.
