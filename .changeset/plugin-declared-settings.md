---
"forgerie": minor
---

Let Forgerie plugins declare settings the user changes in the UI. A plugin may
publish a `settings` list of boolean fields; **Settings → Forgerie plugins**
renders one toggle per field under the plugin's card and saves values to
`plugins[<id>].settings` in the Forgerie config file. Inbox shelves read the
saved values from `context.settings`, keyed by field id, so a change applies
without a tab reload. A malformed declaration (duplicate id, missing label, or
an unsupported type) fails plugin registration instead of rendering silently.
