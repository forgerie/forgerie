/**
 * Fixture data shaped like the real wire types, so the prototype exercises the
 * same fields the app already has. No live network calls — a preview renders
 * from fixtures only.
 *
 * Times are expressed as "minutes ago" and converted to ISO at load, so the
 * board always looks freshly used instead of frozen in the past.
 */

const PROJECTS = [
  { id: "forgerie", name: "forgerie", path: "~/code/sandbox/forgerie" },
  { id: "pi-se", name: "pi-software-engineering", path: "~/code/github/simonwjackson/pi-software-engineering" },
  { id: "korri", name: "korri", path: "~/code/korri" },
  { id: "rocknix", name: "rocknix-sm8550", path: "~/code/rocknix" },
];

const WORKSPACES = [
  { id: "forgerie-main", projectId: "forgerie", path: "~/code/sandbox/forgerie", label: "main", branch: "main", isMain: true },
  { id: "forgerie-inbox", projectId: "forgerie", path: "~/code/sandbox/forgerie-wt/session-inbox", label: "session-inbox", branch: "wt/session-inbox", isMain: false },
  { id: "forgerie-composer", projectId: "forgerie", path: "~/code/sandbox/forgerie-wt/mobile-composer", label: "mobile-composer", branch: "wt/mobile-composer", isMain: false },
  { id: "pi-se-main", projectId: "pi-se", path: "~/code/github/simonwjackson/pi-software-engineering", label: "main", branch: "main", isMain: true },
  { id: "korri-main", projectId: "korri", path: "~/code/korri", label: "main", branch: "main", isMain: true },
  { id: "korri-thor", projectId: "korri", path: "~/code/korri-wt/thor-kiosk", label: "thor-kiosk", branch: "wt/thor-kiosk", isMain: false },
  { id: "rocknix-main", projectId: "rocknix", path: "~/code/rocknix", label: "main", branch: "main", isMain: true },
];

/**
 * `raw` mirrors `SessionInfo` plus the runtime signals that arrive separately
 * (`SessionStatus`, `SessionActivity`, unread catalog membership).
 */
const RAW_SESSIONS = [
  {
    id: "s-01",
    workspaceId: "forgerie-composer",
    firstMessage: "The composer slides under the Android keyboard when I focus it on the cover screen",
    minutesAgo: 4,
    messageCount: 41,
    pendingAsk: "Apply the visualViewport offset to the shell, or only to the composer?",
  },
  {
    id: "s-02",
    workspaceId: "korri-thor",
    firstMessage: "Guest portal shows a blank page after the kiosk rebuild",
    minutesAgo: 11,
    messageCount: 88,
    pendingDialog: "Overwrite /etc/korri/portal.env on bandai?",
  },
  {
    id: "s-03",
    workspaceId: "rocknix-main",
    firstMessage: "Verify the SM8550 image FAT label and block size after the packaging change",
    minutesAgo: 2,
    messageCount: 23,
    phase: "error",
    activityLabel: "fastboot: no devices detected",
  },
  {
    id: "s-04",
    workspaceId: "forgerie-inbox",
    firstMessage: "Build a global session store that survives workspace switching",
    minutesAgo: 0,
    messageCount: 17,
    isStreaming: true,
    activityLabel: "Editing workspaceController.ts",
  },
  {
    id: "s-05",
    workspaceId: "pi-se-main",
    firstMessage: "Run the full eval suite for se-code-review and summarise regressions",
    minutesAgo: 1,
    messageCount: 132,
    isBashRunning: true,
  },
  {
    id: "s-06",
    workspaceId: "forgerie-main",
    firstMessage: "Collapse fork subtrees under their root in the session list",
    minutesAgo: 26,
    messageCount: 64,
    unread: true,
  },
  {
    id: "s-07",
    workspaceId: "forgerie-main",
    firstMessage: "Why does refreshSelectedProjectTopology blank the chat pane sometimes?",
    minutesAgo: 52,
    messageCount: 29,
    unread: true,
  },
  {
    id: "s-08",
    workspaceId: "korri-main",
    firstMessage: "Add a systemd unit for the tailnet reverse proxy and make it restart-safe",
    minutesAgo: 95,
    messageCount: 47,
    unread: true,
  },
  {
    id: "s-09",
    workspaceId: "pi-se-main",
    firstMessage: "Draft the se-backlog promotion flow so parked items can become work items",
    minutesAgo: 190,
    messageCount: 12,
    unread: true,
    parentSessionId: "s-13",
    parentWorkspaceId: "forgerie-main",
  },
  {
    id: "s-10",
    workspaceId: "forgerie-main",
    firstMessage: "Codify the Fold 8 acceptance matrix and intrinsic design rules in AGENTS.md",
    minutesAgo: 300,
    messageCount: 55,
  },
  {
    id: "s-11",
    workspaceId: "forgerie-inbox",
    firstMessage: "Sketch what an inbox-shaped navigation would even look like",
    minutesAgo: 420,
    messageCount: 8,
  },
  {
    id: "s-12",
    workspaceId: "rocknix-main",
    firstMessage: "Investigate why /storage comes up unlabelled on first boot",
    minutesAgo: 1_500,
    messageCount: 73,
  },
  {
    id: "s-13",
    workspaceId: "forgerie-main",
    firstMessage: "Should the backlog live in the repo or in the session log?",
    minutesAgo: 2_600,
    messageCount: 31,
  },
  {
    id: "s-14",
    workspaceId: "korri-main",
    firstMessage: "Compare Thor kiosk boot times before and after the image split",
    minutesAgo: 4_100,
    messageCount: 19,
  },
  {
    id: "s-15",
    workspaceId: "forgerie-main",
    firstMessage: "Point agents at machine-local AGENTS.local.md",
    minutesAgo: 5_000,
    messageCount: 14,
    archived: true,
    archivedMinutesAgo: 4_900,
  },
  {
    id: "s-16",
    workspaceId: "pi-se-main",
    firstMessage: "Clean up gone branches across every worktree",
    minutesAgo: 6_200,
    messageCount: 9,
    archived: true,
    archivedMinutesAgo: 6_100,
  },
  {
    id: "s-17",
    workspaceId: "forgerie-composer",
    firstMessage: "Keep the composer above the Android keyboard",
    minutesAgo: 7_400,
    messageCount: 58,
    archived: true,
    archivedMinutesAgo: 7_300,
  },
];

/** Build the fixture world relative to `now`, so times stay plausible. */
export function loadFixtureWorld(now) {
  const workspacesById = new Map(WORKSPACES.map((workspace) => [workspace.id, workspace]));
  const projectsById = new Map(PROJECTS.map((project) => [project.id, project]));

  const sessions = [];
  const statuses = {};
  const activities = {};
  const unreadSessionIds = new Set();
  const unreadCompletedAt = {};

  for (const raw of RAW_SESSIONS) {
    const workspace = workspacesById.get(raw.workspaceId);
    const modified = isoMinutesAgo(now, raw.minutesAgo);

    const session = {
      id: raw.id,
      cwd: workspace.path,
      path: `${workspace.path}/.pi/sessions/${raw.id}.jsonl`,
      firstMessage: raw.firstMessage,
      created: isoMinutesAgo(now, raw.minutesAgo + raw.messageCount * 3),
      modified,
      messageCount: raw.messageCount,
    };
    if (raw.archived === true) {
      session.archived = true;
      session.archivedAt = isoMinutesAgo(now, raw.archivedMinutesAgo);
    }
    if (raw.parentSessionId !== undefined) {
      session.parentSessionId = raw.parentSessionId;
      session.parentSessionCwd = workspacesById.get(raw.parentWorkspaceId).path;
    }
    sessions.push(session);

    const status = { sessionId: raw.id, isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0 };
    if (raw.pendingAsk !== undefined) status.pendingAsk = { summary: raw.pendingAsk };
    if (raw.pendingDialog !== undefined) status.pendingDialogs = [{ summary: raw.pendingDialog }];
    if (raw.isStreaming === true) status.isStreaming = true;
    if (raw.isBashRunning === true) status.isBashRunning = true;
    statuses[raw.id] = status;

    if (raw.phase !== undefined || raw.activityLabel !== undefined) {
      activities[raw.id] = {
        sessionId: raw.id,
        phase: raw.phase ?? (raw.isStreaming === true || raw.isBashRunning === true ? "active" : "idle"),
        label: raw.activityLabel ?? "",
      };
    }

    if (raw.unread === true) {
      unreadSessionIds.add(raw.id);
      unreadCompletedAt[raw.id] = modified;
    }
  }

  const locationOf = (session) => {
    const workspace = WORKSPACES.find((candidate) => candidate.path === session.cwd);
    const project = projectsById.get(workspace.projectId);
    return {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      branch: workspace.branch,
      isMain: workspace.isMain,
    };
  };

  return { sessions, statuses, activities, unreadSessionIds, unreadCompletedAt, locationOf };
}

function isoMinutesAgo(now, minutes) {
  return new Date(now - minutes * 60_000).toISOString();
}
