#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium nixpkgs#git -c node
// Session worktrees through the real app and API, in a disposable Git repository:
// create (with a post-create hook), counts, a Land conflict offered to the agent,
// Land, Discard, an existing-workspace opt-out, and archive cleanup (removed and
// kept). Each session sends real first messages (normal model usage). Every
// session is archived and deleted afterwards, and the repository is removed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(root, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(root, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(root, "scripts/lib/fold8-postures.mjs")));
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const app = new URL(process.env.APP_URL ?? "http://127.0.0.1:8512/");
const out = process.env.OUT_DIR ?? "/tmp/fe-wt/e2e";
const prompt = "Live check of a new Forgerie client. Reply with exactly OK. Do not use tools.";
await mkdir(out, { recursive: true });

const repo = join(await mkdtemp(join(tmpdir(), "forgerie-wt-e2e-")), "wt-e2e");
const result = { repo, steps: [], errors: [], sessions: [] };
const step = (name, detail = {}) => { result.steps.push({ name, ...detail }); console.log("✓", name, JSON.stringify(detail)); };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
async function call(path, body) {
  const response = await fetch(api + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}
async function waitUntil(label, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(150);
  }
}

// A repository with a post-create hook slow enough to watch.
await mkdir(join(repo, ".forgerie/hooks"), { recursive: true });
git(join(repo, ".."), "init", "-q", "-b", "main", repo);
git(repo, "config", "user.name", "Forgerie e2e"); git(repo, "config", "user.email", "e2e@example.invalid");
await writeFile(join(repo, "README.txt"), "base\n");
await writeFile(join(repo, ".forgerie/hooks/worktree-post-create"), "#!/bin/sh\nset -eu\necho \"setting up $PWD\"\nsleep 2\necho \"installed 3 packages\"\n");
await chmod(join(repo, ".forgerie/hooks/worktree-post-create"), 0o755);
git(repo, "add", "."); git(repo, "commit", "-q", "-m", "base");

const profile = await mkdtemp(join(tmpdir(), "aui-real-wt-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
const shot = async (name) => {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
};
const until = (expression, timeoutMs) => waitUntil(expression, () => evaluate(cdp, expression), timeoutMs);
const clickText = (selector, text) => evaluate(cdp, `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent.trim().startsWith(${JSON.stringify(text)})); if (!node) return false; node.click(); return true; })()`);
const selectedId = () => evaluate(cdp, "new URLSearchParams(location.search).get('session')");
async function open(url) { await cdp.send("Page.navigate", { url }); }
async function startFromDialog(query, label) {
  const url = new URL(app); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  await open(url.href);
  await until("!!document.querySelector('dialog.ns-dialog[open] [data-composer-input]')", 30_000);
  await until(`document.querySelector('.destination-value')?.textContent === ${JSON.stringify(label)}`, 30_000);
  await until("!document.querySelector('.model-trigger')?.textContent.startsWith('No model')", 30_000);
  await evaluate(cdp, `(() => { const input = document.querySelector('.ns-dialog [data-composer-input]'); input.focus();
    input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  await evaluate(cdp, "document.querySelector('.ns-dialog [data-composer-input]').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ctrlKey: true }))");
}
async function sessionOf(id) { return (await call("/api/sessions/all")).sessions.find((session) => session.id === id); }
async function waitIdle(session) {
  await waitUntil(`idle ${session.id}`, async () => {
    const status = await call(`/api/sessions/${session.id}/status?cwd=${encodeURIComponent(session.cwd)}`);
    return status.persisted && !status.isStreaming && !status.isCompacting && (status.pendingMessageCount ?? 0) === 0;
  }, 600_000);
}
async function openSession(id) { const url = new URL(app); url.searchParams.set("session", id); await open(url.href); await until("(() => { const status = document.querySelector('.connection-status')?.textContent; return !!status && status !== 'Connecting'; })()", 30_000); await sleep(400); }

try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES.find((p) => p.name === "folded-portrait"), colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);

  // 1. Create: the default is a fresh worktree; the setup card shows the hook while it runs.
  await startFromDialog({ new: repo }, "wt-e2e · new worktree from main");
  step("the dialog defaults a Git project to a fresh worktree", { label: "wt-e2e · new worktree from main" });
  await until("document.querySelector('.wt-setup-title')?.textContent === 'Preparing worktree' && [...document.querySelectorAll('.wt-steps li')].some((li) => li.textContent.startsWith('Run worktree-post-create') && li.dataset.state === 'running')", 30_000);
  await shot("create-hook-running");
  step("the setup card showed the post-create hook running");
  const first = await until("new URLSearchParams(location.search).get('session')", 120_000);
  const created = await waitUntil("listed", () => sessionOf(first));
  result.sessions.push(created);
  assert.match(created.cwd, /\/\.worktree\/s-[^/]+$/u);
  assert.equal(created.worktree?.owned, true);
  step("the session opened in its own worktree", { cwd: created.cwd, branch: created.worktree.branch });
  await waitIdle(created);
  await until("!!document.querySelector('.worktree-chip') && !document.querySelector('.wt-setup')", 30_000);
  step("a clean setup left no trace once the turn was live; the branch chip shows", { chip: await evaluate(cdp, "document.querySelector('.worktree-chip').textContent") });

  // 2. Counts: a commit and an edit in the worktree, read on the next open.
  await writeFile(join(created.cwd, "README.txt"), "from the worktree\n");
  git(created.cwd, "commit", "-q", "-am", "Change the README in the worktree");
  await writeFile(join(created.cwd, "scratch.txt"), "dirty\n");
  await openSession(first);
  await until("document.querySelector('.worktree-chip [data-mark=ahead]')?.textContent === '↑1' && document.querySelector('.worktree-chip [data-mark=dirty]')?.textContent === '±1'", 30_000);
  await shot("counts-chip");
  step("the chip reads one commit ahead and one changed file");
  await evaluate(cdp, "document.querySelector('.app-opener')?.click()");
  await until(`document.querySelector('[data-session="${first}"] .worktree-marks')?.textContent === '↑1±1'`, 15_000);
  await shot("counts-row");
  step("the inbox row carries the same counts");
  await evaluate(cdp, "document.querySelector('.picker [aria-label=\"Close sessions\"]')?.click()");
  await rm(join(created.cwd, "scratch.txt"));

  // 3. Conflict: main changes the same line. Land stops, lists the file, and offers the agent the server's prompt.
  await writeFile(join(repo, "README.txt"), "from main\n");
  git(repo, "commit", "-q", "-am", "Change the README on main");
  await evaluate(cdp, "document.querySelector('[aria-label=\"Session menu\"]').click()");
  await until("!!document.querySelector('.session-menu')");
  await shot("menu");
  assert.ok(await clickText(".session-menu [role=menuitem]", "Land on main"));
  await until("!!document.querySelector('dialog.wt-dialog[open]')");
  assert.ok(await clickText(".wt-foot button", "Land on main"));
  await until("document.querySelector('.wt-outcome')?.dataset.tone === 'conflict'", 60_000);
  const files = await evaluate(cdp, "[...document.querySelectorAll('.wt-list li')].map((li) => li.textContent)");
  assert.deepEqual(files, ["README.txt"]);
  await shot("conflict");
  step("Land hit a rebase conflict and listed its file", { files });
  assert.ok(await clickText(".wt-foot button", "Ask the agent to resolve"));
  await until("!document.querySelector('dialog.wt-dialog[open]')", 30_000);
  step("Ask the agent to resolve sent the conflict as a prompt");
  await sleep(1500);
  await waitIdle(created);
  const rebased = git(repo, "merge-base", "--is-ancestor", "main", git(created.cwd, "rev-parse", "HEAD")) === "";
  step("the agent finished its turn", { rebasedOntoMain: rebased, worktreeHead: git(created.cwd, "log", "--oneline", "-3") });
  if (git(created.cwd, "status", "--porcelain") !== "") { git(created.cwd, "add", "-A"); git(created.cwd, "commit", "-q", "-m", "Commit what the agent left"); }

  // 4. Land: the confirm step, then the sha; the conversation stays readable and read-only.
  await openSession(first);
  await until("!!document.querySelector('[aria-label=\"Session menu\"]')", 30_000);
  await evaluate(cdp, "document.querySelector('[aria-label=\"Session menu\"]').click()");
  await until("!!document.querySelector('.session-menu')");
  await clickText(".session-menu [role=menuitem]", "Land on main");
  await until("!!document.querySelector('dialog.wt-dialog[open]')");
  await clickText(".wt-foot button", "Land on main");
  await until("document.querySelector('.wt-outcome')?.dataset.tone !== undefined", 60_000);
  const landedTitle = await evaluate(cdp, "document.querySelector('.wt-outcome-title').textContent");
  await shot("landed-outcome");
  assert.match(landedTitle, /^Landed on main at [0-9a-f]{7}$/u, landedTitle);
  assert.equal(landedTitle.slice(-7), git(repo, "rev-parse", "--short=7", "main"));
  step("Land reported the sha main now points at", { landedTitle });
  await clickText(".wt-foot button", "Done");
  await until("!!document.querySelector('.wt-receipt') && !document.querySelector('[data-composer-input]')", 30_000);
  await openSession(first);
  await until("!!document.querySelector('.wt-receipt') && document.querySelectorAll('.message-group > *').length > 0", 30_000);
  assert.equal(existsSync(created.cwd), false);
  await shot("landed-reopened");
  step("after a reload the landed conversation is readable, with its receipt and no input bar", {
    receipt: await evaluate(cdp, "document.querySelector('.wt-receipt-text strong').textContent"),
    status: await evaluate(cdp, "document.querySelector('.connection-status').textContent") });
  await evaluate(cdp, "document.querySelector('.app-opener')?.click()");
  await until(`document.querySelector('[data-session="${first}"] .worktree-row-state')?.dataset.state === 'landed'`, 15_000);
  await shot("landed-row");
  step("its inbox row stays enabled and says landed", { disabled: await evaluate(cdp, `document.querySelector('[data-session="${first}"]').getAttribute('aria-disabled')`) });

  // 5. Discard: the confirm step lists the unlanded commit.
  await startFromDialog({ new: repo }, "wt-e2e · new worktree from main");
  const second = await until("new URLSearchParams(location.search).get('session') !== null && new URLSearchParams(location.search).get('session') !== " + JSON.stringify(first) + " && new URLSearchParams(location.search).get('session')", 120_000);
  const toDiscard = await waitUntil("listed", () => sessionOf(second));
  result.sessions.push(toDiscard);
  await waitIdle(toDiscard);
  await writeFile(join(toDiscard.cwd, "idea.txt"), "an idea\n");
  git(toDiscard.cwd, "add", "idea.txt"); git(toDiscard.cwd, "commit", "-q", "-m", "Try an idea");
  await openSession(second);
  await until("!!document.querySelector('[aria-label=\"Session menu\"]')", 30_000);
  await evaluate(cdp, "document.querySelector('[aria-label=\"Session menu\"]').click()");
  await until("!!document.querySelector('.session-menu')");
  await clickText(".session-menu [role=menuitem]", "Discard worktree");
  await until("document.querySelector('.wt-lead')?.textContent.startsWith('1 commit not on main will be lost')", 30_000);
  await shot("discard-confirm");
  step("Discard listed the unlanded commit before asking", { lead: await evaluate(cdp, "document.querySelector('.wt-lead').textContent") });
  await clickText(".wt-foot button", "Discard worktree");
  await until("document.querySelector('.wt-outcome-title')?.textContent === 'Worktree discarded'", 60_000);
  await clickText(".wt-foot button", "Done");
  await until("document.querySelector('.wt-receipt-text strong')?.textContent === 'Worktree discarded'", 30_000);
  assert.equal(existsSync(toDiscard.cwd), false);
  await shot("discarded");
  step("the discarded conversation stays open and read-only");

  // 6. Opt out: the main checkout itself, from the URL's explicit choice.
  await startFromDialog({ new: repo, place: "existing" }, "wt-e2e");
  const third = await until("(() => { const id = new URLSearchParams(location.search).get('session'); return id && id !== " + JSON.stringify(first) + " && id !== " + JSON.stringify(second) + " ? id : null; })()", 120_000);
  const existing = await waitUntil("listed", () => sessionOf(third));
  result.sessions.push(existing);
  assert.equal(existing.cwd, repo);
  assert.equal(existing.worktree, undefined);
  await waitIdle(existing);
  await openSession(third);
  await sleep(800);
  assert.equal(await evaluate(cdp, "!!document.querySelector('.worktree-chip')"), false);
  step("an opted-out session runs in the main checkout with no worktree controls");

  // 7. Archive: a clean worktree is removed; one with an unlanded commit is kept, with the server's reason.
  async function freshSession(except) {
    await startFromDialog({ new: repo }, "wt-e2e · new worktree from main");
    const id = await until(`(() => { const id = new URLSearchParams(location.search).get('session'); return id && !${JSON.stringify(except)}.includes(id) ? id : null; })()`, 120_000);
    const session = await waitUntil("listed", () => sessionOf(id));
    result.sessions.push(session);
    await waitIdle(session);
    return session;
  }
  const clean = await freshSession([first, second, third]);
  await openSession(clean.id);
  await until("!document.querySelector('[aria-label=\"Archive and next\"]').disabled", 30_000);
  await evaluate(cdp, "document.querySelector('[aria-label=\"Archive and next\"]').click()");
  const removed = await waitUntil("archive cleanup", async () => {
    const record = (await call(`/api/sessions/worktrees/${clean.worktree.id}`)).worktree;
    return record.archiveCleanup ? record : undefined;
  }, 60_000);
  assert.equal(removed.archiveCleanup.kind, "removed");
  assert.equal(existsSync(clean.cwd), false);
  step("archiving a clean, landed worktree removed it", { archiveCleanup: removed.archiveCleanup });

  const kept = await freshSession([first, second, third, clean.id]);
  await writeFile(join(kept.cwd, "keep.txt"), "keep\n");
  git(kept.cwd, "add", "keep.txt"); git(kept.cwd, "commit", "-q", "-m", "Unlanded work");
  await openSession(kept.id);
  await until("!document.querySelector('[aria-label=\"Archive and next\"]').disabled", 30_000);
  await evaluate(cdp, "document.querySelector('[aria-label=\"Archive and next\"]').click()");
  const note = await until("[...document.querySelectorAll('.picker-toast')].map((n) => n.textContent).find((t) => t.includes('Kept worktree')) ?? null", 60_000);
  await shot("archive-kept");
  assert.equal(existsSync(kept.cwd), true);
  step("archiving a worktree with unlanded work kept it and showed the server's reason", { note });
} catch (error) {
  result.failure = error instanceof Error ? error.stack : String(error);
  console.error("✗", result.failure);
  if (cdp) await shot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  // Clean up: archive and delete every session this run made, discard any worktree left, remove the repository.
  for (const session of result.sessions) {
    const latest = await sessionOf(session.id).catch(() => undefined) ?? session;
    const worktree = latest.worktree;
    if (worktree?.state.kind === "active") {
      const preview = await call(`/api/sessions/worktrees/${worktree.id}/discard-preview`, {}).catch(() => undefined);
      if (preview) await call(`/api/sessions/worktrees/${worktree.id}/discard`, { confirmationToken: preview.confirmationToken }).catch((error) => result.errors.push(`cleanup discard: ${error.message}`));
    }
    if (!latest.archived) await call(`/api/sessions/${session.id}/archive`, { cwd: latest.cwd }).catch((error) => result.errors.push(`cleanup archive: ${error.message}`));
    await call("/api/sessions/bulk/delete-archived", { sessions: [{ id: session.id, cwd: latest.cwd }] }).catch((error) => result.errors.push(`cleanup delete: ${error.message}`));
  }
  const left = (await call("/api/sessions/all")).sessions.filter((session) => result.sessions.some((made) => made.id === session.id)).map((session) => session.id);
  result.leftOver = left;
  try { await cdp?.close?.(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(1000);
  await rm(join(repo, ".."), { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ steps: result.steps.length, errors: result.errors, leftOver: left, failure: result.failure ? "yes" : "no" }));
}
await readFile(join(out, "result.json"));
