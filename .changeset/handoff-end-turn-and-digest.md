---
"forgerie": patch
---

Handoffs continue again after preparation. A preparation run that ended with `end_turn` instead of a final text message was marked failed even when it had written the handoff document, so the new session stopped after it was created. The handoff document now decides readiness unless the run ended with an error or abort. Preparation is also faster: the server now writes a readable digest of the source branch beside the raw snapshot, so the preparation agent no longer has to write scripts to extract a large JSON file first.
