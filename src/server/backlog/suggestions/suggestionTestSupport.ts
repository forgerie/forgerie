import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { SessionWorktrees } from "../../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../../workspaces/sessionWorktreeStore.js";
import type { BacklogSuggestion } from "../../../shared/backlogSuggestions.js";
import type { Project } from "../../../shared/apiTypes.js";

const execute = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> { return (await execute("git", ["-C", cwd, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", FORGERIE_MANAGED_WORKTREE_SETUP: "1" } })).stdout.trim(); }
export async function repository() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-suggestions-"));
  await git(root, "init", "-b", "main"); await git(root, "config", "user.name", "Backlog User"); await git(root, "config", "user.email", "backlog@example.test");
  await writeFile(join(root, "README.md"), "Project\n"); await git(root, "add", "."); await git(root, "commit", "-m", "initial");
  const project: Project = { id: "project", name: "Project", path: root, createdAt: "2026-10-20T00:00:00Z" };
  return { root, project, worktrees: new SessionWorktrees(new SessionWorktreeStore(join(root, ".git/worktree-store.json"))), dispose: () => rm(root, { recursive: true, force: true }) };
}
export function suggestion(overrides: Partial<BacklogSuggestion> = {}): BacklogSuggestion {
  return { id: "suggestion", sessionId: "chat", projectId: "project", sessionTitle: "Main work", title: "Improve launch recovery", body: "Keep the first prompt.", context: { why: "We found a recovery gap", files: ["src/launch.ts"], decisions: ["Use durable receipts"] }, destination: { provider: "markdown", path: ".forgerie/backlog/2026-10-20-improve-launch-recovery.md" }, defaultModel: { modelSpec: "provider/cheap", thinkingLevel: "low" }, createdAt: "2026-10-20T00:00:00Z", revision: 1, state: { kind: "open" }, ...overrides };
}
