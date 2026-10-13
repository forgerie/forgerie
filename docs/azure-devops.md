# Azure DevOps backlog

Forgerie can list Azure work items for a project and Area Path. **Mine** lists
items assigned to the owner of the personal access token. **Everyone** lists
open items for that same project and Area Path. An item can start a session
with its description, acceptance criteria, and reproduction steps. The same claim, resume, release, and archive flow used
for GitHub issues applies.

This first release is read-only. It does not change Azure assignment or state,
post comments, or fetch attachments or discussions.
Azure Repos remain ordinary local Git repositories for session worktrees.

## Connect an organization

Use a PAT only if your organization permits it. Microsoft recommends Entra
sign-in for long-lived integrations. This release uses a PAT by explicit user
choice. It requires manual renewal and cannot use company sign-in to renew it.

1. Open your organization's personal access token settings. For Amaze Insights,
   use <https://dev.azure.com/amazeinsights/_usersSettings/tokens>.
2. Create a token scoped to **amazeinsights**, with **Work Items: Read** and **Code: Read** (`vso.code`).
   Choose a short expiry permitted by your company. Do not choose full access.
3. On the Forgerie server, as the user who runs Forgerie, create the credential
   directory and open the token file in an editor:

   ```sh
   install -d -m 700 ~/.local/share/forgerie/azure-devops
   umask 077
   nix shell nixpkgs#nano -c nano ~/.local/share/forgerie/azure-devops/amazeinsights.pat
   ```

4. Paste only the token into that file, save, and close the editor. Never paste
   it into chat, a shell command, project config, or a repository.
5. Make the file private:

   ```sh
   chmod 600 ~/.local/share/forgerie/azure-devops/amazeinsights.pat
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
repo file** removes that override. Changes apply on the next read. Credentials
stay in the PAT file, not in Settings.

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

Mine lists every work-item type assigned to the PAT owner in that Azure
project, not only Stories or the current sprint. It does not list items from
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

Azure Everyone removes `System.AssignedTo = @Me` and excludes `Completed` and
`Removed` states in WIQL, before applying the 500-item cap. It makes one extra
id-only `@Me` WIQL call to mark your items. It also reads all work-item type
state definitions before the broad query to discover the closed-state names;
Mine reads definitions only for types in your result. No `connectionData`
request or guessed user identity is used. Scope stays bounded by the configured
project and Area Path. Set an Area Path before using Everyone in a large Azure
project. A team or board name is not an Area Path.

## Behavior and limits

- Mine uses `System.AssignedTo = @Me`, so "me" is the PAT owner. It is not
  the agent, a guessed email address, or the person who opened the browser.
- State categories come from Azure's work-item type definitions. `Completed`
  and `Removed` items are closed. Unknown categories block session launch.
  Mine hides closed items until **Show done items** is selected. Everyone
  excludes them at the server, so that control cannot reveal them.
- Descriptions, acceptance criteria, and reproduction steps convert from HTML
  to inert text. Images and link targets are not fetched. The session receives
  quoted content with an instruction not to obey commands inside it. This
  reduces prompt-injection risk but cannot eliminate it. Read the item first.
- Each list or detail read queries Azure again. There is no stale cache. A
  launch re-reads the item, and a second scope query checks membership
  after batch retrieval. Azure can still change after the final read.
- A scan reads at most 500 items (including closed items in Mine), in batches
  of 200. A truncated scan warns and refuses launch rather than implying that
  it read every item. Narrow the Area Path if you reach this limit.
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

Credentials are file-based. There is no browser token-entry form.
The browser shows Azure links, source labels, and errors using the existing
backlog components. This provider cannot edit Azure items or post comments.

## Sources

- [Microsoft authentication guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops).
- [Assigned-to queries and WIQL](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops).
- [Work-item state categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list?view=azure-devops-rest-7.1).

## Pull requests

Azure Repos pull requests can now be linked and watched read-only. This replaces
the earlier backlog-only limitation above. A human creates and merges the PR
in Azure DevOps. Forgerie cannot create, merge, complete, vote, comment, or
abandon an Azure PR. Its panel has no merge action.

Use the same organization PAT file described above, with **Code: Read**
(`vso.code`) as well as **Work Items: Read**. No token goes into chat or project
configuration. Replacing the file applies on the next read.

The session's `origin` remote selects the provider and repository. HTTPS
`dev.azure.com` (including userinfo), legacy `visualstudio.com`,
`ssh.dev.azure.com:v3`, and legacy `vs-ssh.visualstudio.com:v3` origins are
supported. Project and repository names are percent-decoded. Link a PR number
or Azure PR URL in the existing pull request panel. A URL supplies the number;
the session's origin still selects the repository.

Azure sessions have an `azure_pr` agent tool with `read`, `link`, `watch`, and
`stop` actions. Give a PR number, or omit it to select the one active PR whose
source branch is the session's branch. If none or several match, give a number.
The tool does not receive the PAT. GitHub tools and watches keep their behavior.

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
