# Session picker: responsibilities of the current left drawer

Status: inventory only. No design, no code. Input for step 4 of the
assistant-ui MVP (`.worktree/new-ui-mvp`).

Source: `main` at `a348db81`, read on 2026-09-29. All client paths are under
`src/client/src/`. All server paths are under `src/server/`. Line numbers are
from that commit.

Labels:

- **verified**: I read the code path from the control to the API call or
  state change.
- **inferred**: the claim rests on names, comments, or a partial read.

## Summary

The left drawer is `<app-navigation-panel>`
(`components/appShell/AppNavigationPanel.ts`). It holds two things:

1. A machine chooser. It is `<machine-switcher>` when the panel is docked and
   `<machine-list>` in the overlay layout. It shows only when there are two or
   more machines (`AppNavigationPanel.ts:88-114`, `:162-164`).
2. The session inbox, `<session-inbox-panel>`
   (`components/SessionInboxPanel.ts`, 2128 lines). This is one board for the
   whole machine. It groups sessions by what they need from the user. It is
   not a project/workspace tree.

The drawer data is one machine-wide store, `globalSessions`
(`controllers/sessionInboxController.ts`). Two HTTP reads fill it:
`GET /sessions/all` and `GET /sessions/asks`. Events on the `/events`
WebSocket keep it current.

Five of the user's examples are **not** drawer responsibilities today:
search, notifications, subsessions, handoffs, and cleanup. Section 13 lists
where each one lives. Some older code for the drawer is still in the repo but
the app does not use it. Section 14 lists it.

## 1. Component tree (verified)

| Element | File | Role |
|---|---|---|
| `<aside class="panel-surface" data-side="navigation">` | `components/PiWebApp.ts:3584-3608` | Drawer surface. Hidden, sheet (peek), or docked. |
| `.mobile-navigation-panel` | `PiWebApp.ts:3844-3846` | Same panel as a full main view in the overlay layout. |
| `<app-navigation-panel>` | `components/appShell/AppNavigationPanel.ts` | Composes the machine chooser and the inbox. Wired at `PiWebApp.ts:1619-1656`. |
| `<machine-switcher>` / `<machine-list>` | `components/MachineSwitcher.ts`, `components/MachineList.ts` | Machine chooser. |
| `<session-inbox-panel>` | `components/SessionInboxPanel.ts` | The board: header, menus, groups, rows, undo toast, plugin shelves. |
| `<session-working-runtime>` | `components/SessionWorkingRuntime.ts` | Running timer on Working rows. |
| Board logic (pure) | `sessionBoard.ts` | State classification, groups, age bands, project grouping, triage queue. |
| Location logic (pure) | `inboxLocation.ts` | cwd to project/workspace, and the location chip. |
| Store | `controllers/sessionInboxController.ts` | `globalSessions` slice, snapshots, events, archive and undo. |
| Navigation cascade | `controllers/inboxNavigation.ts` | Opens a row that lives in another workspace or project. |

## 2. Data loading and live sync

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 2.1 | Load every session on the selected machine, archived ones included. | `sessionInboxController.ts:292-356`, `:613-678`. `api/clients.ts:216`. | `GET /api/machines/:m/sessions/all` (`sessions/sessionRoutes.ts:86`), `piSessionService.machineListing()` (`sessions/piSessionService.ts:1310-1382`). Returns `sessions`, `statuses`, `activities` (`shared/apiTypes.ts:392-399`). | verified |
| 2.2 | Load pending asks and extension dialogs for all sessions. Merge them into statuses. | `sessionInboxController.ts:621-624`, `buildStatuses` `:864-899`. | `GET /sessions/asks` (`sessionRoutes.ts:94`), `asksCatalog()` (`piSessionService.ts:1147`), `pendingAskStore.ts`, `pendingExtensionDialogStore.ts`. | verified |
| 2.3 | Apply live events: `session.created`, `session.name`, `session.pinned`, `status.update`, `activity.update`. Status and activity updates batch once per frame. | `sessionInboxController.ts:360-387`, `:450-470`. Routed from `sessionController.ts:282-293`. | WS `/api/machines/:m/events` (`sessionRoutes.ts:559`), opened by `RealtimeSocket` (`sessionSocket.ts:99`, `:137`). Event union at `shared/apiTypes.ts:1481-1486`. | verified |
| 2.4 | Buffer events that arrive during a snapshot. Replay them after the snapshot. | `sessionInboxController.ts:325-333`, `:684-699`. | none | verified |
| 2.5 | Re-snapshot after the socket reconnects. This clears stale Blocked and Working rows after a sessiond restart. | `PiWebApp.ts:1288-1305`. | same as 2.1 and 2.2 | verified |
| 2.6 | Time out each snapshot after 10 s. Retry after 2 s. Mark the board `stale` and show "Reconnecting…". | `sessionInboxController.ts:796-797`, `:701-708`. `SessionInboxPanel.ts:494`, `:507`. | none | verified |
| 2.7 | Keep one board per machine. A machine switch clears the board and discards late answers from the old machine. | `sessionInboxController.ts:295-316`, generation checks throughout. | none | verified |
| 2.8 | Show sessions that the browser is still starting (optimistic rows) before the server knows them. | `PiWebApp.ts:1598-1617` (`navigationGlobalSessions`). | `session.startup` event (`shared/apiTypes.ts:799-803`). | verified |
| 2.9 | Update the board after local mutations: archive, bulk archive, restore, delete, metadata change. | `sessionInboxController.ts:389-448`. Called from `sessionController.ts:1299-1420`, `:2107-2118`. | none | verified |

## 3. Listing, grouping, ordering

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 3.1 | Classify each session into one state. Precedence: archived > blocked (ask, then dialog) > errored > working (compacting, bash, streaming, active) > unread > open. | `sessionBoard.ts:287-342`. | `SessionStatus.pendingAsk`, `pendingDialogs`, `isStreaming`, `isCompacting`, `isBashRunning` (`shared/apiTypes.ts:965-1003`). `SessionActivity.phase` (`:476-493`). | verified |
| 3.2 | Group by state in fixed order: Pinned, Blocked on you, Errored, Working, Unread, Open, Archived. | `BOARD_GROUPS`, `sessionBoard.ts:111-153`. `inboxSections`, `SessionInboxPanel.ts:685-707`. | none | verified |
| 3.3 | Split the Open group into age bands: Last hour, Earlier today, Yesterday, Earlier this week, This month, Older. Bands use local calendar days. | `AGE_BANDS`, `sessionBoard.ts:189-233`. `ageBandKind` `:255-268`. | `SessionInfo.modified` | verified |
| 3.4 | Group by project as the other mode. Groups sort by attention weight, then by name. | `groupSessionsByProject`, `sessionBoard.ts:487-527`. | projects and workspaces (see 3.8) | verified |
| 3.5 | Sort rows inside a group: pinned first, then most recent `modified`. | `byPinnedThenRecency`, `sessionBoard.ts:629-636`, used at `:450`, `:515`, `:553`. | none | verified |
| 3.6 | Pinned rows move to the Pinned group but keep their own state marker and detail. | `boardGroupKind`, `sessionBoard.ts:363-369`. | `SessionInfo.pinned` from `sessionPinStore.ts`. | verified |
| 3.7 | Hide agent-spawned sessions from the board. | `deriveSessionInboxBoard`, `sessionBoard.ts:420-431`. | `SessionInfo.agentSpawned`. Server also marks children of sessions that are delegating now (`inFlightSpawnedSessions.ts:28-39`, `piSessionService.ts:1349-1352`, `:3494-3502`). | verified |
| 3.8 | Resolve each cwd to project, workspace, and branch. Unregistered cwds get an "Unknown workspace" location. | `inboxLocation.ts:64-...`, `SessionInboxPanel.ts:121-139`, `:431-446`. | `GET /projects`, `GET /projects/:id/workspaces` (`app.ts:65`, `:92`). | verified |
| 3.9 | Hide the Archived group until the user asks for it. Reset this choice on each mount and machine switch. | `SessionInboxPanel.ts:252`, `:352`, `:660-668`, `:1044-1054`. | none | verified |
| 3.10 | Collapse and expand groups. Persist the collapsed set and the grouping mode per machine in localStorage (`forgerie:inbox:<machine>:collapsed-bands`, `:groupBy`). Older bands start collapsed. | `SessionInboxPanel.ts:52-108`, `:1056-1069`. `DEFAULT_COLLAPSED_AGE_BANDS`, `sessionBoard.ts:235`. | none | verified |
| 3.11 | Expand the group of the selected session when that session moves into a collapsed group. | `SessionInboxPanel.ts:375-402`. | none | verified |
| 3.12 | Show three empty states: loading, "No sessions yet.", and "All clear". | `SessionInboxPanel.ts:452-500`. | none | verified |

## 4. Row content

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 4.1 | Title: `name`, then `firstMessage`, then `id`. | `SessionInboxPanel.ts:937`. | `session.name` event, `sessionNameGenerator.ts`, `sessionTitleBridge.ts`. | verified (client). Server naming is inferred. |
| 4.2 | Location chip. Grouped by state: project, plus branch when not on main. Grouped by project: branch only, for worktrees. "workspace removed" for cwds that do not resolve. | `SessionInboxPanel.ts:844-866`. `inboxLocationChip`, `inboxLocation.ts:50-57`. | as 3.8 | verified |
| 4.3 | Detail line: the blocked question, the error label, or the working detail ("Compacting context", "Running a command"). | `SessionInboxPanel.ts:879-883`, `sessionBoard.ts:305-331`. | as 3.1 | verified |
| 4.4 | Live-work counts: delegated agents working, managed processes running. Hidden at zero. | `SessionInboxPanel.ts:801-819`. | `SessionStatus.workingAgents`, `runningProcesses`. | verified |
| 4.5 | Pin marker. | `SessionInboxPanel.ts:941-943`. | `SessionInfo.pinned`. | verified |
| 4.6 | Time: a relative age from `modified`, or a running timer for Working rows. The timer starts at `activeSince`, or at first sight in this browser. | `SessionInboxPanel.ts:405-421`, `:944-948`. `relativeTime`, `sessionBoard.ts:608`. | `SessionActivity.activeSince`. | verified |
| 4.7 | State tone and marker per group. | `SessionInboxPanel.ts:757-760`, `:921`. | none | verified |
| 4.8 | Row density: the app passes a stored setting. Row shape changes when a detail line exists. | `SessionInboxPanel.ts:186`, `:919`. `inboxDensity.ts`. Setting in `components/settings/SettingsAppearancePanel.ts`. | none | verified (setting UI not read) |
| 4.9 | Disable rows whose workspace no longer exists, after navigation proves it. | `SessionInboxPanel.ts:873-876`. `PiWebApp.ts:1770-1776`. | none | verified |

## 5. Attention and unread

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 5.1 | Unread set per machine from the daemon unread catalog. | `sessionUnread.ts` (`SessionUnreadController`). `PiWebApp.ts:585-592`. | `GET /sessions/unread` (`sessionRoutes.ts:110`), `sessions.unread` event (`shared/apiTypes.ts:247-255`), `sessionUnreadStore.ts`. | verified |
| 5.2 | Mark a session read only when its chat is selected, rendered, visible, and focused. | `PiWebApp.ts:564-630` (`isSessionSeen`). | `POST /sessions/:id/unread/acknowledge` (`sessionRoutes.ts:118`). | verified |
| 5.3 | Unread dot per machine in the machine chooser, including machines that are not selected. | `unreadPresence.ts`, `PiWebApp.ts:594-603`, `MachineSwitcher.ts:126-131`. Extra sockets per machine at `PiWebApp.ts:1307-1336`. | `/events` on each remote machine, `GET /sessions/unread`. | verified |
| 5.4 | Attention badge on the closed drawer's opener: "blocked" wins over "unread". | `PiWebApp.ts:3551-3572`, `sessionInboxAttention.ts`. | none | verified |
| 5.5 | Blocked sessions (pending ask or dialog) form their own group with the question text. | 3.1, 4.3. | as 2.2 | verified |

## 6. Row actions

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 6.1 | Open a row with click, Enter, or Space. | `SessionInboxPanel.ts:887-897`, `:930-936`. | see 8.1 | verified |
| 6.2 | Archive with the quick ✓ button. Ask for confirmation if the session is Working. Show a 5 s undo toast. A second archive replaces the toast. | `SessionInboxPanel.ts:896-899`, `:952-953`. `PiWebApp.ts:1821-1834`. `sessionInboxController.ts:487-520`, `:776-793`. | `POST /sessions/:id/archive` (`sessionRoutes.ts:460`). Server refuses pinned sessions and sessions with active work (`piSessionService.ts:3087-3101`). | verified |
| 6.3 | Undo an archive from the toast. Report "Session was already deleted" when the restore returns not found. | `SessionInboxPanel.ts:729-751`. `sessionInboxController.ts:529-557`. | `POST /sessions/:id/restore` (`sessionRoutes.ts:504`). | verified |
| 6.4 | Dismiss the undo toast. Any other navigation also dismisses it. | `sessionInboxController.ts:563-567`. `PiWebApp.ts:1697`. | none | verified |
| 6.5 | Pin ("Pin to top") and unpin. Unpin is also the quick button on pinned rows. Archived sessions cannot be pinned. | `SessionInboxPanel.ts:593-599`, `:950-951`. `sessionController.ts:1328-1337`. | `POST /sessions/:id/pin`, `/unpin` (`sessionRoutes.ts:477`, `:486`). `sessionPinStore.ts`. Server broadcasts `session.pinned` (`piSessionService.ts:3253-3268`). | verified |
| 6.6 | Restore an archived row with the quick ↩ button or the menu. | `SessionInboxPanel.ts:591`, `:949`. `PiWebApp.ts:1803-1809`, `sessionController.ts:2107-2118`. | `POST /sessions/:id/restore`, `sessionArchiveStore.ts`. | verified |
| 6.7 | Delete an archived row permanently. The menu asks twice in place. | `SessionInboxPanel.ts:592-594`. `PiWebApp.ts:1643`. `sessionController.ts:1385-1405`. | `POST /sessions/bulk/delete-archived` (`sessionRoutes.ts:163`). | verified |
| 6.8 | Copy the workspace path to the clipboard. | `SessionInboxPanel.ts:601`, `:615-622`. | none | verified |
| 6.9 | Open the row menu by long press (touch only) or context menu (mouse). The press must not also open the session. | `SessionInboxPanel.ts:979-1040`. `rowPress.ts`. | none | verified |

## 7. Board-level commands

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 7.1 | "+ New" button opens the new-session composer. | `SessionInboxPanel.ts:543-549`. `PiWebApp.ts:1979-1990`. | see section 9 | verified |
| 7.2 | Title button opens the grouping menu (State or Project). | `SessionInboxPanel.ts:528-541`, `:630-645`. | none | verified |
| 7.3 | "⋯" menu: Show archived (with count), Manage projects and workspaces, Actions (command palette). | `SessionInboxPanel.ts:647-683`. | see 7.4 | verified |
| 7.4 | Manage projects and workspaces: choose, add, or close a project. Choosing a workspace navigates to it and opens the workspace panel. | `PiWebApp.ts:1646`, `:3872-3893`, `:2217-2225`. `components/WorkspaceManagementDialog.ts`, `components/ProjectDialog.ts`. | `GET/POST /projects`, `DELETE /projects/:id`, `GET /project-directories`, `GET /projects/:id/workspaces` (`app.ts:65-92`). | verified |
| 7.5 | Host the app refresh control in some display modes (PWA). | `SessionInboxPanel.ts:550`. `PiWebApp.ts:1636`, `appShell/appShellController.ts:70`. | none | verified |
| 7.6 | Host the panel's own pin and close controls. | `SessionInboxPanel.ts:207`, `:560`. `PiWebApp.ts:3604`. | none | verified |

## 8. Selection and navigation

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 8.1 | Open any session on the machine, including one in another workspace or project. Resolve the workspace in this order: same workspace, known workspace, other project, then lazy-load each project. Report `unavailable` if nothing matches. | `PiWebApp.ts:1683-1780`. `controllers/inboxNavigation.ts`. | `GET /projects/:id/workspaces`, then the chat loads (`GET /sessions/:id/messages`, `/status`, `/stream-snapshot`). | verified |
| 8.2 | Paint a preview transcript at once while the workspace resolves. | `PiWebApp.ts:1704-1707`. `sessionController.ts:637`. | `GET /sessions/:id/messages?preview=…` | verified (client). Query details are inferred. |
| 8.3 | Drop stale selections when the user picks again quickly (sequence token). | `PiWebApp.ts:1687-1690`. | none | verified |
| 8.4 | Recover queued sends into the draft if the open fails or a newer pick replaces it. | `PiWebApp.ts:1782-1797`. | none | verified |
| 8.5 | Close the drawer sheet after a pick. In the overlay layout, go to the chat. | `PiWebApp.ts:1695`, `:1766`. | none | verified |
| 8.6 | Write the selection to the URL (`?machine&project&workspace&session`). | `route.ts:24-43`. `sessionController.ts:331`, `:701`, `:722`. | none | verified |
| 8.7 | Archive the current session and go to the next item in the triage queue (blocked, errored, unread). When the queue is empty, focus the board. | `PiWebApp.ts:1850-1878`. `sessionInboxController.ts:584-611`. `triageQueue`, `sessionBoard.ts:569-588`. Started from the composer (`PiWebApp.ts:3382`) and `E` (8.8). | as 6.2 | verified |
| 8.8 | Keys. On the board: `J`/`K` move through the visible rows, `G` switches grouping, `A` shows or hides archived, `Escape` closes a menu. In the shell: `E` archives the selected session. From the command palette: "Focus Sessions". | `SessionInboxPanel.ts:299-327`, `:330-342`. `PiWebApp.ts:465-481`, `:2867-2872`. | none | verified |
| 8.9 | Open an agent-spawned child by its file path, and promote a child back into the inbox. These actions start in the workspace Agents panel, not the drawer. | `PiWebApp.ts:1888-1906`, `:2752-2753`. | `POST /sessions/promote-spawned` (`sessionRoutes.ts:536`). | verified |

## 9. Creating sessions (started from the drawer)

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 9.1 | Open a composer that picks a destination (machine, project, workspace) and takes the first prompt. It starts at the current session's location. | `PiWebApp.ts:1979-2010`. `newSessionComposer.ts`, `components/NewSessionComposer.ts`. | `GET /projects`, `GET /projects/:id/workspaces`, `GET /models?cwd=` (`sessionRoutes.ts:54`). | verified (composer internals inferred) |
| 9.2 | Two launch modes. `switch` opens the new session. `rapidfire` stays in the composer and allows only the current workspace. | `newSessionComposer.ts:28`. `PiWebApp.ts:2055-2100`. Palette actions `session.start` (`ctrl+enter`) and `session.start-rapidfire` (`ctrl+shift+enter`) in `plugins/core/actions.ts:181-197`. | `POST /sessions` with `startupToken` and agent choices (`sessionRoutes.ts:63`, `api/clients.ts:227`). | verified |
| 9.3 | Agent choices before the session exists: model and thinking level. | `shared/apiTypes.ts:1494-1497`. `components/NewSessionComposer.agentChoices.test.ts`. | `POST /sessions` | inferred |
| 9.4 | Show the new row at once (see 2.8). Report startup progress and launch failures. | `PiWebApp.ts:1598-1617`, `:2093-2095`. | `session.startup`, `session.created` events. | verified |

## 10. Machines

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 10.1 | List machines. Hide the chooser when there is only one. | `AppNavigationPanel.ts:88-114`, `:162-164`. | `GET /api/machines` (`machines/machineRoutes.ts:7`). | verified |
| 10.2 | Switch machine. Remember and restore each machine's last project, workspace, session, and view. | `PiWebApp.ts:1646` (via `.onSelectMachine`), `:1098-1111`. `controllers/machineNavigationMemory.ts`. | Every read above, under `/api/machines/:m/...` (`machines/machineProxyRoutes.ts:24-39`). | verified |
| 10.3 | Show health (online, offline, error, unknown) per machine. | `MachineSwitcher.ts:56`, `:74`, `:317-323`. `controllers/machineController.ts:96-153`. | `GET /api/machines/:m/health` (`machineRoutes.ts:17`). | verified |
| 10.4 | Show live activity per machine (session or terminal). | `MachineSwitcher.ts:126-131`. `controllers/activityController.ts`. | `GET /activity` (`activity/workspaceActivityRoutes.ts:9`), `workspace.activity` event. | verified |
| 10.5 | Remove a remote machine after confirmation. Fall back to another machine if it was selected. The local machine cannot be removed. | `PiWebApp.ts:3095-3103`. `MachineList.ts:165-167`. | `DELETE /api/machines/:m` (`machineRoutes.ts:45`). | verified |
| 10.6 | Add a machine. This comes from the command palette, not the drawer. | `PiWebApp.ts:2947`, `:3083-3093`. `plugins/core/actions.ts:29`. | `POST /api/machines` (`machineRoutes.ts:9`). | verified |

## 11. Layout and presentation

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 11.1 | Three presentations of one element: hidden, sheet (peek), docked. Pinning moves nothing. | `PiWebApp.ts:3574-3622`. `appShell/panelPeek*.ts`, `appShell/panelIntent*.ts`. | none | verified |
| 11.2 | Layout mode from available width: docked at 820 px or more (260 panel + 560 session), else overlay. | `appShell/shellLayoutMode.ts:1-17`. `appShellController.ts:34-36`. | none | verified (threshold call site not read) |
| 11.3 | In overlay mode, the drawer is a full main view and the machine chooser becomes `<machine-list>`. | `PiWebApp.ts:1635`, `:3844-3846`. `AppNavigationPanel.ts:103-114`. | none | verified |
| 11.4 | Resizable width, and a "Reset Navigation Panel Size" action. | `PiWebApp.ts:2819-2825`. `appShell/panelResizeController.ts`. | none | verified (resize code not read) |
| 11.5 | The radial menu has a dedicated "navigation" target that opens the drawer. | `appShell/radialSlots.ts:41-56`. | none | inferred |
| 11.6 | The board adapts to pane width through container queries. It has no viewport breakpoints. | `SessionInboxPanel.ts:13-20` (header comment). | none | inferred (styles not read) |

## 12. Extension point

| # | Responsibility | Client evidence | Server dependency | Status |
|---|---|---|---|---|
| 12.1 | Render trusted plugin "inbox shelves" under the list. No plugin in this repo registers one. | `SessionInboxPanel.ts:244`, `:513-516`. `PiWebApp.ts:2674-2685`. `plugins/registry.ts:36`, `:62`, `:104`. `plugins/types.ts:68`. | Plugin manifests (`app.ts:175`). | verified. External plugins that use it are unknown. |

## 13. User-named examples that the drawer does not own

| Example | What the code does today | Evidence | Status |
|---|---|---|---|
| Search and filter | No text search and no filter in the drawer. The only reshaping is grouping, collapse, and "Show archived". | No search or filter input in `SessionInboxPanel.ts`. Every "filter" match there is `Array.filter`. | verified |
| Notifications | The board and its rows do not read notification state. Notifications show in a workspace panel and in the chat. | `components/SessionNotificationsPanel.ts`, rendered from `plugins/core/panels.ts:125`. The client drops `notifications.summary` events (`sessionSocket.ts:7`). Routes `sessionRoutes.ts:102`, `:171-205`. | verified |
| Subsessions and spawned sessions | Hidden from the board (3.7). Their only trace is the live-work agent count (4.4). They open from the workspace Agents panel (8.9). | `sessionBoard.ts:420-431`. `components/WorkspaceAgentsPanel.ts`, `delegatedAgents.ts`. | verified |
| Handoffs | A handoff destination is an ordinary new session. It reaches the board through `session.created`. The board does not mark it. The link between the sessions is the "door" in the chat. | `piSessionService.ts:1541`, `:1612`. `handoffDoor.ts`, used only by `components/ChatView.ts`. `PiWebApp.ts:1947-1955`. | verified |
| Forks and parent/child | The board does not show parent links, fork groups, or "children elsewhere". | Zero matches for `parentSession`, `fork`, `childSessionsElsewhere` in `SessionInboxPanel.ts` and `sessionBoard.ts`. | verified |
| Cleanup | Not in the drawer. The drawer reaches it in two steps: "⋯" > Actions > "Clean Up Sessions". A dialog previews, then runs. | `PiWebApp.ts:2807-2812`, `:1560-1596`, `:3898`. `components/SessionCleanupDialog.ts`, `sessionCleanupUi.ts`. Routes `sessionRoutes.ts:139`, `:147`, `sessions/sessionCleanup.ts`. | verified |
| Workspace tree drill-down | Replaced by the board. The Project grouping mode is what remains of it. | `SessionInboxPanel.ts:1-6`. `sessionBoard.ts:478-486`. | verified |

## 14. Code the drawer no longer uses

| Code | Evidence | Status |
|---|---|---|
| `components/SessionList.ts` (760 lines): per-workspace list with fork grouping, orphan groups, parent location, cleanup entry. | No non-test file imports it. `sessionForkGrouping.ts` and `sessionOrphanGroups.ts` are imported only by it. | verified |
| `components/WorkspaceList.ts` | `PiWebApp.ts:84` imports it, but no template renders `<workspace-list>`. | verified |
| `sessionController.archiveSessionWithDescendants` (archive tree), `archiveSessions` (bulk archive), `detachParent`. | No caller outside `controllers/sessionController.ts`. Routes still exist: `sessionRoutes.ts:155`, `:469`, `:522`. | verified |
| WS `/sessions/events` | `api/sockets.ts:9` defines `globalSessionEvents`, but no code calls it. The client uses `/events`. | verified |

## 15. Findings outside the question

| Finding | Importance | Status |
|---|---|---|
| The client asks "Archive it anyway?" for a Working session. The server then refuses archive while the session streams, compacts, runs bash, or has queued messages (`piSessionService.ts:3090`, `:4656-4662`, `:5205-5207`). For those sessions, "yes" only leads to an error. The client Working state also covers `activity.phase === "active"`, so some Working rows can still archive. | Medium. The new picker must not copy this. | verified |
| `restoreInboxSession` has the doc comment "Restore a session from the inbox and navigate to it". The code selects the restored session only if it was already selected (`sessionController.ts:2116-2117`). Otherwise the current chat stays open. | Low | verified |
| `session.created` payloads from the server do not carry `agentSpawned` (`piSessionService.ts:1527-1540`). A spawned child can appear on the board live until the next snapshot or mark. | Low to medium | inferred |
| The pinned group sorts by recency, not by pin time. Two parking-lot items already track this: `01M1DDRZAM7YA2QNQE63ZRSZA5` and `01M1DDSCAK22S5TXDX6MKYQK0Y`. | Low | verified (sort, see 3.5) |

## Server dependencies in one list

All paths are under `/api/machines/:machineId`. The local machine is
`local`, registered at `app.ts:209-212`. Remote machines go through
`machines/machineProxyRoutes.ts`.

| Kind | Endpoint | Used for |
|---|---|---|
| GET | `/sessions/all` | 2.1 |
| GET | `/sessions/asks` | 2.2, 5.5 |
| GET | `/sessions/unread` | 5.1, 5.3 |
| POST | `/sessions/:id/unread/acknowledge` | 5.2 |
| POST | `/sessions` | 9.2 |
| GET | `/models?cwd=` | 9.1 |
| POST | `/sessions/:id/archive` | 6.2, 8.7 |
| POST | `/sessions/:id/restore` | 6.3, 6.6 |
| POST | `/sessions/:id/pin`, `/unpin` | 6.5 |
| POST | `/sessions/bulk/delete-archived` | 6.7 |
| POST | `/sessions/promote-spawned` | 8.9 |
| GET | `/sessions/:id/messages`, `/status`, `/stream-snapshot` | 8.1, 8.2 |
| GET/POST/DELETE | `/projects`, `/projects/:id`, `/project-directories`, `/projects/:id/workspaces` | 3.8, 7.4, 8.1 |
| GET | `/activity` | 10.4 |
| WS | `/events` | 2.3, 5.1, 5.3, 9.4, 10.4 |
| GET/POST/DELETE | `/api/machines`, `/api/machines/:m/health` (no machine prefix) | 10.1, 10.3, 10.5, 10.6 |

Server stores behind these routes, all in `sessions/`: `sessionArchiveStore.ts`,
`sessionPinStore.ts`, `sessionUnreadStore.ts`, `pendingAskStore.ts`,
`pendingExtensionDialogStore.ts`, `sessionTabsStore.ts`,
`sessionCatalogScanner.ts`, `agentSpawnedMarks.ts`.
