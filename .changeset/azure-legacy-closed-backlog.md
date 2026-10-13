---
"forgerie": patch
---

Treat Azure work items whose old states lack a current category as closed when ClosedDate is set. Keep undated unknown states visible and blocked, with one counted warning per project and provider. Exclude ClosedDate records from Everyone queries before the 500-item cap while preserving Mine's own closed items. Use scope-correct scan-limit warnings and refer to the signed-in Azure DevOps user rather than assuming a PAT.
