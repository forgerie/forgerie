# Azure DevOps backlog, first stage

The standalone client uses the existing backlog API for `azure-devops` items.
The backend implementation lives on the main-history branch, not this orphan
client branch. See `docs/azure-devops.md` in the main checkout for PAT setup and
per-repository routing.

## Scope

The user chose Azure Repos as the code host, staged delivery, an isolated
backend worktree, and an organization-scoped read-only PAT. This stage lists
assigned work items, reads their context, and uses the existing session launch,
claim, release, and archive flow. Azure writes and pull requests are not part
of this stage. Nothing automatically configures a local Amaze repository.

## Presentation

No new layout or styling system. `BacklogView` remains the binding and page,
`SettingsFrame` remains the shared template, and the existing row, properties,
menus, warnings, and carry components render Azure data. Source words and
short display numbers come from `remoteSource` in `src/backlog/backlogModel.ts`.
The full organization-qualified ID stays in URLs and API calls.

Azure access failures never enter GitHub setup. They remain in the existing
problem disclosure, including when the assigned list is empty. An item page
uses a work-item link, Azure status, and a note that local claims do not change
Azure assignment or status. Missing-item text mentions reassignment, not a
missing Markdown file.

## Evidence

- The backend's full `npm run verify` passed 504 files, 5,170 tests, with 4
  existing skips. The 21 Azure-specific tests use a real local HTTP service,
  the production parser and provider, the existing Fastify backlog routes,
  and temporary files and claim storage. No real Azure request was made.
- The final client `npm run verify` passed the build, typecheck, lint, and 904
  tests across 95 files. Other sessions also had unrelated edits in this
  worktree during the run. Only this feature's files are included in its commit.
- `scripts/azure-backlog-acceptance.mjs` passed 24 checks: three states, four
  Fold viewports, and both color schemes. It checks exact viewport dimensions,
  horizontal overflow, primary-action and menu bounds, and preservation of
  an open menu, expanded error disclosure, and `#42` filter while resizing.
- Captured and visually reviewed 24 list/item/error screenshots plus eight
  expanded error screenshots. They use CDP device emulation at the recorded
  Fold DPR, not a Chromium window-size approximation.
- Screenshots and browser results are in `verification/local/azure-backlog/`.
  Eight `sheet-*.png` contact sheets show all 24 base captures. The originals
  and `auth-open-*.png` captures are retained beside `browser-checks.json`.
- The same header and actions remain across the posture matrix. The item title
  wraps in the reading column and truncates only in the header. Long content
  scrolls while Start session stays in the header. No new breakpoint was added.

Run the browser checks with the existing dev server on port 8510:

```sh
./scripts/azure-backlog-acceptance.mjs
```

The fixture is `verification/github-backlog.html`, with `state=azure-list`,
`state=azure-item`, or `state=azure-auth`. All Azure records there are synthetic.

## Limits that remain

Live access to Amaze Insights is unverified. The operator must save a PAT
outside Git and map the intended local repository to the Azure project and,
when required, its exact Area Path. A team name is not an Area Path.

The visual review used the measured Fold viewports in headless Chromium,
not the physical device. Tab Ultra viewport measurements are still absent.

The backend's dependency audit reports the same 25 package findings as main,
including 20 high and 5 moderate findings. The new HTML-to-text dependency
introduced no additional advisory package. This work does not fix that existing
security maintenance issue.
