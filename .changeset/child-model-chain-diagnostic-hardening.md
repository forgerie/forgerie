---
"forgerie": patch
---

Bound provider-diagnostic processing, replace credential failures with category-only diagnostics, and sanitize recovered workflow failures and older results. Preserve normal compaction for single-model and same-provider children; decline only when a fallback would forward another provider's error text.
