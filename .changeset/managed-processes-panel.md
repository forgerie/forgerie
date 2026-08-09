---
"forgerie": patch
---

Add first-class managed process support without a separate machine package. Forgerie now bundles its compatible process runtime, shows process lifecycle events (success, failure, crash, and log matches) in chat, and adds a Processes workspace panel for viewing status, controlling processes, and inspecting output. Exposes `ManagedProcessesRuntime` in the unstable plugin API for third-party panels.
