---
"forgerie": minor
---

Replace issue proposal approvals with parent-only `file_issue`. Search open and closed issues for close titles, require explicit duplicate overrides, add `agent-filed` (create it if missing), and record successful filing in the decision log. Refuse before filing if the required label cannot be established. Keep old proposal messages readable without create/dismiss actions.
