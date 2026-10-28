---
"forgerie": patch
---

Preserve the original single-model retry schedule, honor longer shared model cooldowns, and avoid fallback on unrelated numbers or tool names. Redact and bound provider diagnostics in child retries, model requests, cooldowns, run history, and parent reports. Continuation prompts no longer forward provider error text, including on the legacy single-model path.
