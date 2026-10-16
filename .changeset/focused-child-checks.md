---
"forgerie": patch
---

Child agents now check their work with focused checks: the tests for the files they changed, the typecheck and the linter. They run the project's full test suite only when their task says so. In a workflow run, the agent runs the full suite once per stage, on the stage's combined result, through the stage's reviewer or itself.
