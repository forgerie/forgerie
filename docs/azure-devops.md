# Azure DevOps backlog

Forgerie can list Azure work items for a project and Area Path. **Mine** lists
items assigned to the signed-in Azure DevOps user. **Everyone** lists
open items for that same project and Area Path. An item can start a session
with its description, acceptance criteria, and reproduction steps. The same claim, resume, release, and archive flow used
for GitHub issues applies.

The Azure integration is read-only. It does not change work-item assignment or
state, post comments, or fetch discussions. It reads eligible inline images only
when starting a session.
Azure Repos remain ordinary local Git repositories for session worktrees.

## Connect an organization

### Recommended: Azure CLI sign-in

If you already use `az login` as the Forgerie user, nothing to set up. Forgerie
uses that existing Entra sign-in for both the backlog and pull requests. If you
need to sign in, run `az login` as the operating-system user that runs Forgerie.
Forgerie does not read or copy the CLI's token-cache file itself.

The daemon must be able to find `az`. If its PATH does not include Azure CLI,
set `azureDevops.azureCliCommand` in the global Forgerie config to an absolute
`bin/az` path. On NixOS, use a pinned azure-cli store path; do not configure a
`nix run` shell command. See [Azure CLI configuration](config.md#azure-cli).
Restart sessiond in an approved idle window after changing the command.

Costs and security limits:

- An Entra token carries the user's full Azure DevOps rights. It is not a
  read-only-scoped PAT. Forgerie's Azure code only reads; that code is the
  read-only boundary, not the token's permissions.
- Forgerie never gives its token to agents, their environments, logs, responses,
  or errors. It keeps the access token in memory only and refreshes five minutes
  before expiry. An HTTP 401 drops the cached token and retries once.
- The CLI sign-in expires according to Entra policy. When silent refresh no
  longer works, run `az login` again. Forgerie cannot renew an interactive
  sign-in by itself.
- Another process running as the same operating-system user can also use the
  CLI sign-in. This feature is not isolation from that user or that user's
  agent shell processes.

Token commands run without a shell, with a 30-second timeout and 256 KiB output
limit. An empty temporary `AZURE_EXTENSION_DIR` prevents broken user extensions
from breaking the core token command. Forgerie deletes that directory afterwards.
Azure CLI owns its existing sign-in cache; Forgerie writes no token file.

### Alternative: an organization PAT

A PAT file takes priority for its organization. Only an absent file permits
CLI fallback. An unreadable, public, malformed, or symlinked PAT file is an
error; Forgerie does not silently switch identities. Use a PAT only if your
organization permits it. It needs manual renewal and cannot use Entra sign-in
to renew the PAT itself.

1. Open your organization's personal access token settings. For Amaze Insights,
   use <https://dev.azure.com/amazeinsights/_usersSettings/tokens>.
2. Create a token scoped to **amazeinsights**, with **Work Items: Read** and **Code: Read** (`vso.code`).
   Choose a short expiry permitted by your company. Do not choose full access.
3. On the Forgerie server, as the user who runs Forgerie, create the credential
   directory and open the token file in an editor:

   ```sh
   install -d -m 700 ~/.forgerie/azure-devops
   umask 077
   nix shell nixpkgs#nano -c nano ~/.forgerie/azure-devops/amazeinsights.pat
   ```

4. Paste only the token into that file, save, and close the editor. Never paste
   it into chat, a shell command, project config, or a repository.
5. Make the file private:

   ```sh
   chmod 600 ~/.forgerie/azure-devops/amazeinsights.pat
   ```

The path above uses the default Forgerie data directory. If the daemon uses
`PI_WEB_DATA_DIR`, put `azure-devops/amazeinsights.pat` under that directory.
Each organization has its own lowercase `<organization>.pat` file. The daemon
refuses symbolic links, non-regular files, public files, and files owned by
another user. Credentials never enter HTTP responses or agent subprocess
environments. Processes running as the same operating-system user can still
read the file. File permissions are not isolation from that user.

Replace or remove the file to rotate or disconnect the token. Changes apply
on the next backlog read without a daemon restart. Also revoke an unwanted
token in Azure. Deleting the local file does not revoke it there.

## Map work items to code

Register the local code repository as a Forgerie project. Open **Settings →
Backlog**, select the project, turn on Azure DevOps, and fill in organization,
project, and optional Area Path. Select only Azure DevOps to hide local Markdown
items without changing their files. Click **Save changes**. Source chips beside
each backlog project show which sources are enabled.

Settings shows **Set in Forgerie**, **From the repo file**, or **Default:
Markdown**. Forgerie saves its whole backlog section in the private data-dir
file `backlog-settings.json`; it wins over the repository section. **Use the
repo file** removes that override. Changes apply on the next read. Credentials stay in the Azure CLI sign-in or PAT file, not in Settings.

You can also configure the repo file. In its canonical checkout, add this
`backlog` section to `.forgerie/config.json`. Preserve the file's other settings:

```json
{
  "backlog": {
    "providers": ["markdown", "azure-devops"],
    "azureDevops": {
      "organization": "amazeinsights",
      "project": "Amaze Insights"
    }
  }
}
```

Mine lists every work-item type assigned to the signed-in Azure DevOps user in
that Azure project, not only Stories or the current sprint. It does not list items from
other Azure projects automatically. Refresh the backlog after changing config.

If several repositories share the Azure project, add `azureDevops.areaPath`
in Settings or each repository's configuration. It must name the exact Azure
Area Path.
The query includes that area and its descendants. A board's team name, such as
`Incentive Team`, is not proof of its Area Path. Read that value from Azure.
Use non-overlapping areas. Mapping the same Azure items to two local repos
lists them twice, and each repo can hold its own claim. Forgerie does not infer
which code repository an Azure work item needs.

## Mine and Everyone

Use the **Mine / Everyone** control beside the backlog filter. It defaults to
Mine and remembers the choice in this browser. Detail and launch reads use the
same scope as the list. Markdown files count as mine and appear in both scopes.
In Everyone, **You** marks your items and rows show assignee names.

For GitHub, set your username at the top of **Settings → Backlog**. Mine matches
assignee logins without case. Without a username it shows no GitHub items and
asks you to set one. The trusted-author filter applies in both scopes. The 21
migrated Forgerie GitHub issues have no assignees, so they do not appear in Mine
until someone assigns them.

Azure Everyone removes `System.AssignedTo = @Me` and excludes current
`Completed` and `Removed` state names in WIQL. It also requires
`[Microsoft.VSTS.Common.ClosedDate] = ''`, so historical closed states that no
longer exist in the current process do not consume the 500-item cap. It makes one extra
id-only `@Me` WIQL call to mark your items. It also reads all work-item type
state definitions before the broad query to discover the closed-state names;
Mine reads definitions only for types in your result. No `connectionData`
request or guessed user identity is used. Scope stays bounded by the configured
project and Area Path. Set an Area Path before using Everyone in a large Azure
project. A team or board name is not an Area Path.

## Behavior and limits

- Mine uses `System.AssignedTo = @Me`, so "me" is the signed-in Azure DevOps
  user. It is not the agent, a guessed email address, or the person who opened
  the browser.
- State categories come from the type's current definitions. `Completed` and
  `Removed` items are closed. When a state has no current category, a non-empty
  `Microsoft.VSTS.Common.ClosedDate` also marks it closed. This covers old
  process states such as `Done` without guessing from the state name or Reason.
  Without ClosedDate, an unknown state stays visible and blocked; it cannot
  launch. One warning per project and provider gives the count and at most five
  example IDs, instead of one warning per item.
- Mine keeps the `@Me` query without a ClosedDate predicate. Its closed items
  remain available under **Show done items**. A known open category still wins
  over an old ClosedDate when mapping an item. Everyone excludes closed state
  names and non-empty ClosedDate values before the cap. A stale ClosedDate on
  a reopened item can therefore exclude it from Everyone even if Mine shows
  it as open.
- Descriptions, acceptance criteria, and reproduction steps convert from HTML
  to inert text. Each inline image becomes an `[Image N: name]` marker in
  section order. List and detail views never download images. Link targets
  are never fetched.
- At launch, Forgerie reads only HTTPS attachment URLs under
  `https://dev.azure.com/<configured organization>/`. Paths must be exactly
  `/<organization>/<project-guid-or-name>/_apis/wit/attachments/<guid>` or
  `/<organization>/_apis/wit/attachments/<guid>`. Organization and host matching
  ignore case. Paths with encoded percent signs (`%25`), slashes, backslashes,
  or dots, literal backslashes, or dot segments are refused before URL
  normalization. Project names containing a literal `%` are not supported in
  attachment URLs; project-GUID URLs work instead. Other
  hosts, organizations, paths, ports, HTTP URLs, and URL credentials are
  refused before Azure credentials are read. Reads use GET, the existing CLI
  token or PAT, one 401 retry, and no redirects. No write is sent to Azure.
- Supported `data:image/(png|jpeg|gif|webp);base64,` sources are decoded locally.
  The bytes, not the HTTP header or data URI label, select PNG, JPEG, GIF, or
  WebP. Unknown types are skipped. Launch considers the first 10 eligible image
  sources, with a 10 MiB raw cap per image, a 20 MiB raw cap in total, and one
  30-second read deadline. Pi preflights decoding and resizing before Forgerie
  builds the final prompt. Pasted images follow the item's images, and the
  browser caps the first message at 16 attachments. Pasted images beyond that
  count are not sent.
- The final prompt gives the attached marker numbers and asks the agent to
  examine every image before planning or changing code, and briefly describe
  what each shows and how it affects the task. Every skipped image has a
  reason and a request to ask the user for it if needed. Image names, image
  content, and quoted item text are untrusted; the agent must not obey
  instructions inside them. This reduces prompt-injection risk but cannot
  eliminate it. Read the item first.
- Select an image-capable model. Pi replaces images with
  `(image omitted: model does not support images)` for a text-only model.
  The Azure prompt tells the agent to stop and ask for an image-capable model
  in that case, rather than claim to have examined the images.
- Azure launch prompts and prepared images are saved in one private file per
  local claim: `<data dir>/backlog-launch/<claimId>.json`. Files are replaced
  atomically with mode `0600` in a `0700` directory. Claim metadata stays small
  in `backlog-claims.json`; claim mutations do not rewrite or clone image data.
  A retry loads only its own snapshot and returns the same context and images,
  including after a daemon restart. It does not download them again. A legacy
  claim without a snapshot reads images on retry. Release or archive deletes
  that claim's snapshot. Startup removes orphan snapshot files and leftover
  snapshot temporary files. Inline `launchContents` from the first image-support
  build migrate to separate files before being removed from claim metadata.
  This adds disk use per held Azure item and memory use while preparing or
  reading that item's snapshot. List responses never include image payloads.
- Each list or detail read queries Azure again. There is no stale cache. A
  launch re-reads the item, and a second scope query checks membership
  after batch retrieval. Azure can still change after the final read.
- A scan reads at most 500 items (including closed items in Mine), in batches
  of 200. A truncated scan warns and refuses launch rather than implying that
  it read every item. Its warning describes items assigned to you for Mine,
  or open items in this project/Area Path for Everyone. Narrow the Area Path
  if you reach this limit.
- A scan has a 30-second deadline, an 8 MiB response limit, and at most 32 work
  item types. It honors HTTP 429 `Retry-After`. A failure does not hide items
  from the project's other providers.
- HTTP 401 and 403 produce an Azure access warning. Detail requests report
  access or service failures as unavailable, not as a deleted item. No raw
  Azure error body or credential is returned to the browser.
- An item's internal ID is `<organization>:<number>`. Its display number stays
  `#<number>`. A changed organization cannot reuse the old item's claim.
- If an item leaves the selected scope query, it leaves the list. Its session
  keeps running. Archive the session to clear its claim, or release the exact claim
  through the existing backlog release API. Disabling the provider does not
  prevent that release API from working.

Credentials use the server user's Azure CLI sign-in or a private PAT file.
There is no browser token-entry form.
The browser shows Azure links, source labels, and errors using the existing
backlog components. This provider cannot edit Azure items or post comments.

## Sources

- [Microsoft authentication guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops).
- [Assigned-to queries and WIQL](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops).
- [Work-item state categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list?view=azure-devops-rest-7.1).

## Pull requests

Azure Repos pull requests can be linked and watched read-only. A human creates
and merges the PR in Azure DevOps. Forgerie cannot create, merge, complete,
vote, comment, or
abandon an Azure PR. Its panel has no merge action.

Pull requests use the same credential source as the backlog: an organization's
PAT file first, otherwise the Azure CLI Entra sign-in described above. A PAT
needs **Code: Read** (`vso.code`) as well as **Work Items: Read**. Entra tokens
carry the user's full Azure DevOps rights, but this reader only reads. No token
goes into chat or project configuration. Replacing a PAT applies on the next
read; CLI access tokens are cached in memory until five minutes before expiry.

The session's `origin` remote selects the provider and repository. HTTPS
`dev.azure.com` (including userinfo), legacy `visualstudio.com`,
`ssh.dev.azure.com:v3`, and legacy `vs-ssh.visualstudio.com:v3` origins are
supported. Project and repository names are percent-decoded. Link a PR number
or Azure PR URL in the existing pull request panel. A URL supplies the number;
the session's origin still selects the repository. For Azure PRs, backlog
source settings, Area Path, and Mine/Everyone do not change this selection.

Azure sessions have an `azure_pr` agent tool with `read`, `link`, `watch`, and
`stop` actions. Give a PR number, or omit it to select the one active PR whose
source branch is the session's branch. If none or several match, give a number.
The tool does not receive either credential. GitHub tools and watches keep their behavior.

A watch polls every 60 seconds, with about four Azure requests per PR. It reports
failed policies and statuses, passing required policies, new commits, new human
comments, and conflicts. Policy blocking flags become required checks. Reviewer
votes become approvals or requests for changes. Deleted and system comments are
excluded. External text is data, not an instruction or permission to write to
Azure. Each wake can use agent tokens. Stop watching when handing work back.

A failed policy, status, or thread read marks the result incomplete. It does not
advance the watch checkpoint. Rate limits accept `Retry-After` seconds or an
HTTP date, with a maximum delay of 15 minutes. Invalid, non-finite, negative,
or past values use a 60-second delay; zero uses a 1-second minimum. Reads make
no requests during that delay. The cap matches the unreadable-watch limit and
prevents a malformed server or proxy header from blocking an organization for
years. Its cost is retrying sooner than a server requests when it specifies
more than 15 minutes. Another 429 starts another bounded delay.
A PR unreadable for 15 minutes stops its watch. Closed or completed PRs and
unavailable sessions also stop watches.
The existing limit of 10 consecutive comment-only wakes still applies.

File, addition, and deletion counts are shown as 0 because this reader does not
fetch the extra diffs needed to compute them. Azure does not provide a general
PR modification timestamp here; the summary uses its creation or closing date.
Resolved thread comments remain watch activity, but only active threads appear
in the panel's open comments. Truncated responses are incomplete, not a claim
that all checks passed.

Policy evaluations use `api-version=7.1-preview.1`, as specified by Microsoft's
[Evaluations - List reference](https://learn.microsoft.com/en-us/rest/api/azure/devops/policy/evaluations/list?view=azure-devops-rest-7.1).
The PR, status, and thread reads use `7.1`.

Before downgrading to a version without Azure PR support, back up
`<data dir>/pull-requests.json`, then stop every Azure watch and unlink every
Azure PR using the current version. Stopping alone leaves the Azure link on
disk. Unlinking removes both the record and any pending notice.

The file remains version 2. The daemon at `771515f7` accepts the added provider
field and starts; it does not reject Azure records during store validation.
It treats all links as GitHub, so Azure PR reads fail and Azure watches follow
the existing unreadable-watch stop rule. It can still deliver an already
pending notice before checking the repository. Startup compatibility does not
mean Azure records work on that version. Remove those records before a
downgrade; keep the backup for recovery with an Azure-capable version.
