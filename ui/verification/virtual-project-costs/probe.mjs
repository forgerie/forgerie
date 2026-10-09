#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#git -c node
// Research probe only. All mutable fixtures live in a new temporary directory.
// Usage: ./probe.mjs /absolute/path/to/forgerie/node_modules/@earendil-works/pi-coding-agent
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(process.argv[2]);
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
const root = await mkdtemp(join(tmpdir(), "forgerie-multirepo-probe-"));
const agentDir = join(root, "agent");
const bundle = join(root, "bundle");
const a = join(bundle, "repo-a");
const b = join(bundle, "repo-b");
const checks = [];
const record = (name, evidence) => checks.push({ name, evidence });
async function file(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Research", GIT_AUTHOR_EMAIL: "research@example.invalid", GIT_COMMITTER_NAME: "Research", GIT_COMMITTER_EMAIL: "research@example.invalid" },
  }).trim();
}
try {
  await file(join(agentDir, "AGENTS.md"), "Global fixture instructions.\n");
  await file(join(bundle, "AGENTS.md"), "Bundle fixture instructions.\n");
  await file(join(a, "AGENTS.md"), "Only repo-a: run its checks.\n");
  await file(join(b, "AGENTS.md"), "Only repo-b: run its checks.\n");
  const discovered = sdk.loadProjectContextFiles({ cwd: bundle, agentDir });
  assert(discovered.some(x => x.path === join(bundle, "AGENTS.md")));
  assert(!discovered.some(x => x.path === join(a, "AGENTS.md") || x.path === join(b, "AGENTS.md")));
  record("parent-cwd-context-discovery", "Bundle instructions load; neither member's child AGENTS.md loads automatically.");

  const memberContexts = await Promise.all([a, b].map(async cwd => ({
    path: join(cwd, "AGENTS.md"), content: await readFile(join(cwd, "AGENTS.md"), "utf8"),
  })));
  const loader = new sdk.DefaultResourceLoader({
    cwd: bundle, agentDir, settingsManager: sdk.SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: base => ({ agentsFiles: [...base.agentsFiles, ...memberContexts] }),
  });
  await loader.reload();
  for (const member of memberContexts) assert(loader.getAgentsFiles().agentsFiles.some(x => x.path === member.path && x.content === member.content));
  record("member-context-override", "Public agentsFilesOverride includes both member instruction files with original paths. This tests loading, not model obedience or precedence.");

  for (const cwd of [a, b]) {
    await file(join(cwd, ".pi/skills/check/SKILL.md"), "---\nname: check\ndescription: Check this repository.\n---\nRun the repository checks.\n");
  }
  const skillPaths = [a, b].map(cwd => join(cwd, ".pi/skills"));
  const combined = sdk.loadSkills({ cwd: bundle, agentDir, skillPaths, includeDefaults: false });
  assert.equal(combined.skills.length, 1);
  assert.equal(combined.diagnostics.filter(x => x.type === "collision").length, 1);
  record("duplicate-skill-names", "Two different skills named check produce one visible skill and one collision diagnostic.");
  const qualified = [a, b].flatMap((cwd, i) => sdk.loadSkills({ cwd, agentDir, skillPaths: [skillPaths[i]], includeDefaults: false }).skills.map(skill => ({ ...skill, name: `repo-${i === 0 ? "a" : "b"}-${skill.name}` })));
  const qualifiedLoader = new sdk.DefaultResourceLoader({
    cwd: bundle, agentDir, settingsManager: sdk.SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    skillsOverride: base => ({ ...base, skills: qualified }),
  });
  await qualifiedLoader.reload();
  assert.deepEqual(qualifiedLoader.getSkills().skills.map(x => x.name), ["repo-a-check", "repo-b-check"]);
  record("qualified-skill-loader", "skillsOverride preserves two qualified skill names and original file paths. Slash-command invocation and extension compatibility are not tested.");

  await file(join(agentDir, "settings.json"), JSON.stringify({ defaultModel: "global-model" }));
  await file(join(a, ".pi/settings.json"), JSON.stringify({ defaultModel: "a-model" }));
  await file(join(b, ".pi/settings.json"), JSON.stringify({ defaultModel: "b-model" }));
  const parentSettings = sdk.SettingsManager.create(bundle, agentDir, { projectTrusted: true });
  assert.equal(parentSettings.getSettings().defaultModel, "global-model");
  assert.equal(sdk.SettingsManager.create(a, agentDir, { projectTrusted: true }).getSettings().defaultModel, "a-model");
  assert.equal(sdk.SettingsManager.create(b, agentDir, { projectTrusted: true }).getSettings().defaultModel, "b-model");
  parentSettings.applyOverrides({ defaultModel: "bundle-choice" });
  assert.equal(parentSettings.getSettings().defaultModel, "bundle-choice");
  await parentSettings.reload();
  assert.equal(parentSettings.getSettings().defaultModel, "global-model");
  record("settings-scope-and-reload", "Parent cwd does not merge child settings. Per-member trusted settings differ. An in-memory bundle override works but reload drops it.");

  const store = join(root, "sessions");
  const manager = sdk.SessionManager.create(bundle, store);
  manager.appendMessage({ role: "user", content: "Cross-repo research fixture", timestamp: Date.now() });
  const reopened = sdk.SessionManager.open(manager.getSessionFile(), store);
  assert.equal(reopened.getSessionId(), manager.getSessionId());
  assert.equal(reopened.getCwd(), bundle);
  const listed = await sdk.SessionManager.list(bundle, store);
  assert(listed.some(x => x.id === manager.getSessionId()));
  record("non-git-session-persistence", "A non-Git parent cwd persists, reopens with the same ID/cwd, and lists using an explicit session directory. No model run or Forgerie lifecycle tested.");

  for (const cwd of [a, b]) {
    git(cwd, "init", "-b", "main");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "Initial fixture");
  }
  const wa = join(root, "work-a");
  const wb = join(root, "work-b");
  git(a, "worktree", "add", "-b", "session-test", wa);
  git(b, "worktree", "add", "-b", "session-test", wb);
  assert.equal(git(a, "rev-parse", "--path-format=absolute", "--git-common-dir"), git(wa, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  assert.notEqual(git(a, "rev-parse", "--path-format=absolute", "--git-path", "index"), git(wa, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  record("worktree-git-storage", "A worktree shares its repository common Git directory but has a separate index. Different repos remain independent.");

  for (const cwd of [wa, wb]) {
    await file(join(cwd, "change.txt"), "Session change\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "Session change");
    git(cwd, "rebase", "main");
  }
  const expectedA = git(a, "rev-parse", "session-test");
  // Both branches preflighted successfully. An unrelated actor changes B next.
  await file(join(b, "other.txt"), "Concurrent main update\n");
  git(b, "add", ".");
  git(b, "commit", "-m", "Concurrent main update");
  const expectedB = git(b, "rev-parse", "main");
  git(a, "merge", "--ff-only", "session-test");
  assert.throws(() => git(b, "merge", "--ff-only", "session-test"));
  assert.equal(git(a, "rev-parse", "main"), expectedA);
  assert.equal(git(b, "rev-parse", "main"), expectedB);
  record("partial-landing-after-preflight", "After both rebases pass, a concurrent B update causes B fast-forward to fail. A remains landed. This demonstrates the race, not a production coordinator.");

  console.log(JSON.stringify({ sdkVersion: version, gitVersion: git(root, "--version"), checksPassed: checks.length, checks }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
