# Public repository scan

Before the first push to `forgerie/forgerie`, Gitleaks 8.30.0 scanned the
history reachable from `main` at `81501269`. That history has 1,759 commits.
Gitleaks scanned 1,663 commits with patches, about 24.90 MB.

The scan used the default rules, full secret redaction, ignored
`gitleaks:allow` comments, and archive traversal to depth 2.

## Findings reviewed

All three findings are false positives from the generic API-key rule.
The historical source and test show that these strings name browser
`localStorage` entries, not credentials.

| Commit | File and line | Value |
| --- | --- | --- |
| `83fb0c16` | `src/client/src/appShell/radialSlots.test.ts:22` | `forgerie.radialSlots.v2` |
| `83fb0c16` | `src/client/src/appShell/radialSlots.ts:36` | `forgerie.radialSlots.v2` |
| `d09e85e6` | `src/client/src/appShell/radialSlots.ts:25` | `forgerie.radialSlots.v1` |

A second history scan used only these three reviewed fingerprints as its
baseline. It reported no additional findings. No history rewrite was needed.

Separate scans of the exported tracked tree, commit messages, and all 19
backlog source files reported no findings. A historical filename search
found no `.env` files, `auth.json`, `github-app.json`, SSH private-key filenames,
or files ending in `.pem`, `.key`, `.p12`, `.pfx`, or `.jks`.

## Publication boundary

Publish only the scanned `main` branch. Other branches, tags, worktrees,
uncommitted changes, local credentials, and the app's private key are not
part of this push. Scan the final migration commit before pushing it.

This is an automated scan with manual review of its findings, not proof that
every possible secret is absent. The scanner can miss unknown formats and
secrets in opaque binary data. Public Git history also exposes ordinary
commit author names, email addresses, paths, and internal notes.
