# Backlog sources: one Azure board, one list, one claim per item

Date: 2026-10-13. Status: brief for approval. Workflow run `cface4af…`.

## Problem

Forgerie scans the Azure DevOps backlog once per registered repository. The four
Amaze repositories (amaze-next, portal-react-source, portal-source,
sql-inc-source) have the same Azure section (`amazeinsights` / `Amaze Insights`,
no Area Path) in `backlog-settings.json`. Each work item is listed 4 times. A
claim is keyed by `repo + provider + itemId`
(`src/server/backlog/backlogClaimStore.ts:16`, `backlogScanner.ts:52`), so the
same item can hold one session in each repository. Launch also refuses any cwd
outside the scanning repository (`backlogService.ts:112-114`).

An Azure work item belongs to an Azure project, not to a code repository. The
repository must stop being the owner of an Azure backlog.

## Agreed model (contract, not reopened here)

- A backlog source is its own record, owned by no repository and no project group.
- It has one optional destination project, which is a setting. Code never names a repository.
- Each work item appears once. One item has at most one claim, so one session.
- No destination means "not routed": a manual launch asks for a project; automation (later) skips the item visibly.
- A manual launch shows the destination and allows any registered project instead.
- Development links are not a routing signal. Tag/type rules and classification are out of scope.
- Overlapping sources on one board are rejected at save.
- GitHub and Markdown keep per-repository behavior; their destination is the owning repository.

## Decisions

### 1. Source record

```ts
interface BacklogSource {
  id: string;                     // server-generated UUID; never derived from names
  provider: "azure-devops";       // the only standalone provider in this change
  organization: string;           // stored as entered; compared lower-case
  project: string;                // Azure project name; compared case-insensitively
  areaPath?: string;              // exact Area Path; UNDER semantics as today
  destinationProjectId?: string;  // a registered Forgerie project id; absent = not routed
  revision: number; updatedAt: string;
}
```

Stored in the data-dir `backlog-settings.json`, which becomes version 2 with a
new `sources: Record<id, BacklogSource>` beside `projects` and `githubLogin`.
`BacklogSettingsStore` stays the single writer, with its queue, atomic rename,
and file-wide monotonic revision (no ABA on delete and recreate).

| Route (settings prefix) | Body | Effect |
|---|---|---|
| `POST /backlog/settings/sources` | `{organization, project, areaPath?, destinationProjectId?}` | Create. 409 on overlap. 400 on an unregistered destination project. |
| `PUT /backlog/settings/sources/:id` | same fields + `baseRevision` | Replace. 409 on revision conflict or overlap. |
| `DELETE /backlog/settings/sources/:id` | `{baseRevision}` | Delete. Live claims are kept and still releasable. |

`GET /backlog/settings` also returns `sources[]`. A destination whose project is
later unregistered stays on disk and resolves to `not-routed: missing-project`;
it is never cleared silently.

Reason: sources must outlive any repository and any group, and the data dir is
already where Forgerie keeps the user's backlog settings. Cost: a file version
that older daemons cannot read (see 6).

### 2. Overlap rule

Two Azure sources overlap when organization and project match
(case-insensitive) and either has no Area Path, or one Area Path equals the
other or is under it. Compare by `\`-separated segments, case-insensitive: `A\B`
is under `A`; `A\Bc` is not under `A\B`. Save is refused with 409 and a message
that names the other source, for example: "Overlaps amazeinsights / Amaze
Insights (no Area Path). Give both sources Area Paths that do not overlap." The
pure function lives in `src/shared/` so Settings shows the same reason.

Overlaps can still exist after migration (6). They are flagged, not rejected on
read. Items are de-duplicated by the claim key (4); the earliest-created source
wins, so an item still appears once.

### 3. List

`BacklogService.list` scans each source once, then each project for its
project-owned providers (Markdown, GitHub). A per-project `azure-devops` provider
no longer exists.

- An Azure group is keyed `source:<id>` and labelled with the source: "Amaze
  Insights", with "amazeinsights" and the Area Path (if set) muted. The group
  header shows the destination: "→ amaze-next", or "Not routed".
- Mine and Everyone work as today; the scope is passed to the source scan.
- Project groups for Markdown and GitHub do not change.
- "In a session" still lists held items first, across sources and projects.
- The list response keeps `projects[]` and adds `sources[]`:
  `{sourceId, label, provider, destination, warnings}`.

### 4. Claim identity

| Provider | Claim key |
|---|---|
| `azure-devops` | `provider + itemId` (itemId is already `org:number`, e.g. `amazeinsights:4750`) |
| `markdown`, `github` | `repo + provider + itemId`, unchanged |

One function, `claimKeyOf(claim | item)`, is the only place that builds the key.
`get`, `reserve`, the scanner overlay, de-duplication, and the load-time
duplicate check all use it. The claim keeps `projectId`, `repo` and `cwd`; for
Azure they now describe where the session runs (the chosen destination), not
where the item was scanned. A new optional `sourceId` records the source.
Snapshots stay keyed by `claimId`; release and archive still remove one claim by
`claimId`.

Why one item cannot have two live claims: `reserve` runs in the store's single
mutation queue, looks up by `claimKeyOf`, and refuses any existing claim
(`launching`, `claimed` or `interrupted`). Tests cover two destinations racing
for one Azure item.

Existing claims: the claim file stays version 1; only the key function changes.
A legacy file can hold two live Azure claims for one item from two repositories.
Today `initialize` throws "Duplicate backlog claims" on duplicates, which would
stop the daemon. Instead, on load such a group is kept whole and marked
**contested**: the list shows the item as claimed, with a warning that names
every holding session; launch for that item is refused until release or archive
leaves one claim. No claim is dropped and no new duplicate can be created. This
host's claim file has 0 claims (read 2026-10-13, file written 14:45), so the
path protects other users and restored backups, not current data here.

Cost: an Azure item can no longer be claimed once per repository. That is the
intended change.

### 5. Destination

```ts
type Destination =
  | { kind: "routed"; projectId: string; reason: "source-destination" | "project-owned" }
  | { kind: "not-routed"; reason: "unset" | "missing-project" };
function resolveDestination(owner: BacklogOwner, item: BacklogItem, projects: readonly Project[]): Destination;
```

Pure, in `src/shared/backlogDestination.ts`, used by the server (list, launch)
and the browser (labels). Markdown and GitHub items resolve to their own
project. An Azure item resolves to its source's `destinationProjectId` when that
project is registered, otherwise `not-routed`. It never guesses. It takes the
item only so a later ordered rule list can sit before the destination without
changing callers; this change adds no rules.

Every listed item carries its `destination`. A later "assigned to me → session"
automation calls the same resolver and records "not routed" items as skipped.
Nothing in this change launches without a user.

Manual launch:

- Routed: the new-session dialog opens with the destination project as its
  destination (today it opens at `item.repo`, `ui/src/App.tsx:233-246`). The
  carry line reads "Starts in amaze-next · source destination". The existing
  destination picker changes it to any registered project and workspace.
- Not routed: the dialog opens with no destination; Start stays disabled until
  the user picks one. The carry line reads "This source has no destination.
  Choose a project, or set one in Settings → Backlog."
- Server: for Azure items, launch accepts a cwd whose canonical root is any
  registered project, records that project in the claim, and refuses an
  unregistered path with 400. Markdown and GitHub keep the current rule (cwd
  must belong to the item's repository).

### 6. Settings migration

Runs once, inside the settings store, when it reads a version-1 file:

1. Copy the v1 file to `backlog-settings.v1.json` (mode 0600) unless that backup
   already exists.
2. Collect every Azure section from `projects[*].backlog`, and from the repo file
   `.forgerie/config.json` of each registered project that has no settings
   entry. Group by (organization lower-case, project lower-case, Area Path as
   stored). Each group becomes one source, with no destination. On this host:
   one source, `amazeinsights / Amaze Insights`.
3. Remove `azure-devops` and `azureDevops` from each per-project entry. An entry
   with no providers left is removed, so that project falls back to its repo
   file or the Markdown default, as if Azure had never been set there.
4. Write version 2 atomically. If any step fails, the v1 file stays untouched
   and the backlog shows the existing "Cannot read backlog-settings.json" error
   with the cause. Nothing is half-written.

Overlapping groups produced by migration are kept and flagged (2), not merged,
because merging would change which items a user sees.

Repo-file Azure section after migration: **retired, with a warning.** Forgerie
stops reading `backlog.azureDevops` and the `azure-devops` provider from a repo
file. The backlog list and the project's Settings page show: "This repository's
.forgerie/config.json has an Azure DevOps section. Forgerie now reads Azure
boards from Settings → Backlog → Sources." Forgerie never edits that file.

Rejected alternatives: honouring the repo file as a source keeps a repository
as an owner and lets two repositories declare overlapping sources that Settings
cannot reject. Ignoring it silently loses the user's setting without notice.
Cost: a team can no longer share an Azure board setting through the repository.

Downgrade: an older daemon refuses a v2 file with its existing error and does not
overwrite it. To downgrade, restore `backlog-settings.v1.json` over
`backlog-settings.json`. Documented in `docs/azure-devops.md`.

### 7. Wire changes

| Surface | Change | Effect on an old browser tab |
|---|---|---|
| `BacklogItem` | adds `owner: {kind: "project", projectId, projectName, repo} \| {kind: "source", sourceId, label}` and `destination`. `projectId`, `projectName`, `repo` are present only for project-owned items. | Azure rows fail to parse or launch; Markdown and GitHub work. |
| `GET /backlog` | adds `sources[]`; each Azure item appears once with a source owner. | Azure items missing or wrong. |
| Item routes | new `/backlog/sources/:sourceId/items/:itemId`, with `/launch` and `/release`; same bodies and responses as the project routes. Project routes stay for Markdown and GitHub and return 404 "Azure items are listed under their source" for `provider=azure-devops`. | Azure launch fails with that message. |
| `BacklogClaim` | adds optional `sourceId`. | Accepted; the browser schema is not strict. |
| Settings | file v2; source routes (1); `GET /backlog/settings` adds `sources`. | Old settings screen cannot see sources. |
| URL state | `?backlog=` and `&item=` accept `source:<id>/<itemId>` beside `<projectId>/<itemId>`. | Old links to Azure items stop resolving. |

Browser and server ship from one checkout, so this matters only for a tab left
open across a deploy; a reload fixes it.

### 8. UI

Follow `frontend-design` and `intrinsic-design`; no control may become
unreachable at any width. Reuse `SettingsFrame`, `SettingsField`,
`SettingsInput`, `ChoiceList`, `ActionFooter`, `HeaderButton`, `Lede`, the
existing `DestinationPicker`, and the backlog row and group styles.

- **Settings → Backlog list** (`BacklogSettingsList`): a "Sources" section above
  "Projects". One row per source: "Amaze Insights · amazeinsights", its
  destination or "Not routed", and any overlap warning. An "Add Azure DevOps
  source" action.
- **Source editor** (new `BacklogSourceSettings`): Organization, Azure project,
  Area Path, Destination (registered projects, plus "None: ask each time"),
  Save, Delete. Overlap and revision errors appear in the frame's error slot.
- **Project editor** (`BacklogProjectSettings`): sources are Markdown and
  GitHub only; the Azure fields go away. A project whose repo file still has an
  Azure section shows the retirement note from 6.
- **Backlog list** (`BacklogView`, `groupBacklog`): source groups as in 3.
- **Launch** (`NewSession`, `BacklogCarry`): destination line and not-routed
  state as in 5; the existing destination picker is the override.

Caliper parts: change `BacklogSettingsList.page.part.tsx` (no sources, routed
source, not-routed source, overlap warning) and
`BacklogProjectSettings.page.part.tsx` (retired repo-file Azure section); add
`BacklogSourceSettings.page.part.tsx` (new, edit, overlap error, missing
destination project) and a `BacklogCarry` part (routed, not routed). Render each
at the project's Caliper viewports.

### 9. Tests and docs

Server (Vitest; real temp files and in-process HTTP, as nearby tests do):

- Settings store: create, update, delete a source; revision conflicts; overlap
  refused for no Area Path vs any, equal, under; allowed for `A\B` vs `A\Bc` and
  for a different organization or project.
- Migration: four identical v1 Azure sections become one source with no
  destination; per-project entries lose Azure and keep other providers; an entry
  with no providers left is removed; the v1 backup exists and is not
  overwritten; a repo-file section of an unconfigured project is imported; a
  failed write leaves v1 intact.
- List: one source used by four projects lists each item once, in Mine and
  Everyone; a migrated overlapping pair lists each item once and warns.
- Claims: reserving one Azure item from two destination repositories conflicts;
  Markdown items with the same id in two repositories do not; a legacy file with
  two live claims for one Azure item loads, shows the item contested, and
  refuses launch until one is released.
- Resolver: routed, unset, missing project, project-owned.
- Routes: source item detail, launch and release; Azure launch into any
  registered project records that project in the claim; an unregistered cwd is
  400; project routes refuse Azure with 404; Markdown and GitHub launch rules
  unchanged.

Browser (happy-dom component tests and pure model tests):

- `groupBacklog`: one group per source with its destination; held items first.
- Settings: add a source, set its destination, see an overlap error, delete.
- New session: a routed item opens at its destination and can be changed; a
  not-routed item needs a pick before Start.

Docs: rewrite "Map work items to code" in `docs/azure-devops.md` around sources
and destinations. Replace the paragraph that says overlapping areas let each
repository hold its own claim. Add the repo-file retirement and the downgrade
step. Update `docs/config.md` if it describes the repo-file Azure section. Add a
Changeset (user-visible change).

### 10. Out of scope

Automation that launches sessions; routing rules by tag or work-item type; a
classification model; GitHub or Markdown sources outside their repository;
Azure PR linking.

## Risks

- The item owner change touches every `item.projectId` use in `ui/src`
  (`refOf`, `App.tsx` URL state, `heldSessions`, `NewSession`). Each one must be
  checked, not just the ones tests reach.
- For later automation, a wrong destination is silent. Every item carries its
  routing reason now so it stays visible.
- Retiring the repo-file Azure section changes behavior for anyone who set Azure
  that way. The warning and the migration import cover it.
