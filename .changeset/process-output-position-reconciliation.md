---
"forgerie": patch
---

Prevent older HTTP reads from overwriting pushed process snapshots or losing log lines, without hiding selected-output failures. Reconcile log tails and pushed output by absolute line positions, with HTTP recovery for missing batches and older daemons, so repeated output remains exact.
