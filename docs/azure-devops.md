# Azure DevOps backlog

Forgerie can list Azure work items assigned to the owner of a personal access
token. An item can start a session with its description, acceptance criteria,
and reproduction steps. The same claim, resume, release, and archive flow used
for GitHub issues applies.

This first release is read-only. It does not change Azure assignment or state,
post comments, fetch attachments or discussions, or manage Azure pull requests.
Azure Repos remain ordinary local Git repositories for session worktrees.

## Connect an organization

Use a PAT only if your organization permits it. Microsoft recommends Entra
sign-in for long-lived integrations. This release uses a PAT by explicit user
choice. It requires manual renewal and cannot use company sign-in to renew it.

1. Open your organization's personal access token settings. For Amaze Insights,
   use <https://dev.azure.com/amazeinsights/_usersSettings/tokens>.
2. Create a token scoped to **amazeinsights**, with **Work Items: Read** only.
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

Register the local code repository as a Forgerie project. In its canonical
checkout, add this `backlog` section to `.forgerie/config.json`. Preserve the
file's other settings:

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

This lists every work-item type assigned to the PAT owner in that Azure
project, not only Stories or the current sprint. It does not list items from
other Azure projects automatically. Refresh the backlog after changing config.

If several repositories share the Azure project, add `azureDevops.areaPath`
to each repository's configuration. It must name the exact Azure Area Path.
The query includes that area and its descendants. A board's team name, such as
`Incentive Team`, is not proof of its Area Path. Read that value from Azure.
Use non-overlapping areas. Mapping the same Azure items to two local repos
lists them twice, and each repo can hold its own claim. Forgerie does not infer
which code repository an Azure work item needs.

## Behavior and limits

- The query uses `System.AssignedTo = @Me`, so "me" is the PAT owner. It is not
  the agent, a guessed email address, or the person who opened the browser.
- State categories come from Azure's work-item type definitions. `Completed`
  and `Removed` items are closed. Unknown categories block session launch.
  The client hides closed items until **Show done items** is selected.
- Descriptions, acceptance criteria, and reproduction steps convert from HTML
  to inert text. Images and link targets are not fetched. The session receives
  quoted content with an instruction not to obey commands inside it. This
  reduces prompt-injection risk but cannot eliminate it. Read the item first.
- Each list or detail read queries Azure again. There is no stale cache. A
  launch re-reads the item, and a second assignment query checks membership
  after batch retrieval. Azure can still change after the final read.
- A scan reads at most 500 assigned items, including closed items, in batches
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
- If an item leaves the assigned query, it leaves the list. Its session keeps
  running. Archive the session to clear its claim, or release the exact claim
  through the existing backlog release API. Disabling the provider does not
  prevent that release API from working.

Setup is file-based in this release. There is no browser token-entry form.
The browser shows Azure links, source labels, and errors using the existing
backlog components. Azure edits, comments, and Azure Repos pull-request support
are later stages, not hidden capabilities of this provider.

## Sources

- [Microsoft authentication guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops).
- [Assigned-to queries and WIQL](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops).
- [Work-item state categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list?view=azure-devops-rest-7.1).
