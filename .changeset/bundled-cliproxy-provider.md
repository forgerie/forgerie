---
"forgerie": patch
---

Bundle the CLIProxyAPI Pi provider by default, without a separate Pi package install. Use Forgerie's pinned version in the daemon provider baseline and hosted sessions, and exclude profile copies before they can register a second provider. Existing connection settings and terminal Pi installations stay unchanged. Restart the session daemon after upgrading to activate the bundled provider.
