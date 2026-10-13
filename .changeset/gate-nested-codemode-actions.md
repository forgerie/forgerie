---
"forgerie": patch
---

Apply gated-action admission to nested codemode and shared child tool calls. Waiting calls resolve as blocked text so scripts can keep working. Approval runs the exact saved nested call once, including deferred tools, without exposing those tools as direct model declarations.
