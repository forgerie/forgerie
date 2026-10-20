import assert from "node:assert/strict";
import { it } from "vitest";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./redeploy-when-idle.sh", import.meta.url).pathname;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "redeploy-check-"));
  await writeFile(join(root, "curl"), '#!/usr/bin/env bash\nif [[ "$*" == *build.json* ]]; then printf \'{"entry":"test.js"}\\n\'; else printf "%s" "$ACTIVITY"; exit "$CURL_EXIT"; fi\n', { mode: 0o755 });
  await writeFile(join(root, "systemctl"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CALLS"\nexit "$SYSTEMCTL_EXIT"\n', { mode: 0o755 });
  await writeFile(join(root, "git"), '#!/usr/bin/env bash\nprintf "%s\\n" "$GIT_REVISION"\n', { mode: 0o755 });
  return {
    root,
    run(index, item, paths = [], mode = "idle") {
      const args = mode === "immediate" ? ["--now", ...paths, item.revision ?? ""] : ["/own", "0", ...paths];
      return spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env,
        FORGERIE_DEPLOY_SHELL: "1", PATH: `${root}:${process.env.PATH}`, FORGERIE_REDEPLOY_LOG: join(root, `log-${index}`),
        FORGERIE_REDEPLOY_REVISION: item.revision ?? "", GIT_REVISION: item.gitRevision ?? "current",
        ACTIVITY: item.raw ?? JSON.stringify(item.activity), CURL_EXIT: String(item.curlExit ?? 0), SYSTEMCTL_EXIT: String(item.systemctlExit ?? 0), CALLS: join(root, `calls-${index}`),
        CLI_EXIT: String(item.cliExit ?? 0), CLI_CALLS: join(root, `cli-calls-${index}`) } });
    },
    calls: (index) => readFile(join(root, `calls-${index}`), "utf8").catch(() => ""),
    cliCalls: (index) => readFile(join(root, `cli-calls-${index}`), "utf8").catch(() => ""),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

it("restarts only on valid idle activity and reports restart failures", async () => {
  const f = await fixture();
  try {
    const cases = [
      { name: "idle", activity: { workspaces: [] }, pass: true },
      { name: "own session", activity: { workspaces: [{ cwd: "/own", hasSessionActivity: true }] }, pass: true },
      { name: "other session", activity: { workspaces: [{ cwd: "/other", hasSessionActivity: true }] } },
      { name: "missing activity", activity: {} },
      { name: "malformed activity", activity: { workspaces: [{ cwd: "/other" }] } },
      { name: "HTTP failure", activity: { workspaces: [] }, curlExit: 22 },
      { name: "empty response", raw: "" },
      { name: "restart failure", activity: { workspaces: [] }, systemctlExit: 1, restart: true },
    ];
    for (const [index, item] of cases.entries()) {
      const result = f.run(index, item);
      assert.equal(result.status === 0, item.pass === true, `${item.name}: ${result.stdout}\n${result.stderr}`);
      const calls = await f.calls(index);
      assert.equal(calls.includes("restart"), item.pass === true || item.restart === true, item.name);
      if (item.pass === true) assert.deepEqual(calls.trim().split("\n"), [
        "--user restart forgerie-sessiond.service forgerie-web.service",
        "--user is-active --quiet forgerie-sessiond.service",
        "--user is-active --quiet forgerie-web.service",
      ], "Readiness must check each unit independently");
    }
  } finally { await f.close(); }
});

// Publication validation, stop/swap/start, readiness, rollback and retention
// run through the real CLI in src/deployment.test.ts. Here the shell owns
// argument forwarding and exit propagation, not another publication transaction.
it.each([
  { mode: "idle", exitCode: 0 },
  { mode: "idle", exitCode: 37 },
  { mode: "immediate", exitCode: 0 },
  { mode: "immediate", exitCode: 37 },
])("delegates $mode publication and returns publisher exit $exitCode", async ({ mode, exitCode }) => {
  const f = await fixture();
  const prepared = join(f.root, "prepared build"), deployed = join(f.root, "deployed build");
  const revision = "a".repeat(40);
  try {
    await mkdir(prepared);
    await writeFile(join(prepared, "cli.js"), 'require("node:fs").writeFileSync(process.env.CLI_CALLS, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.CLI_EXIT));\n');
    const result = f.run("publish", { revision, cliExit: exitCode, curlExit: 22 }, [prepared, deployed], mode);
    assert.equal(result.status, exitCode, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(await f.cliCalls("publish")), [
      "deploy", prepared, deployed, revision,
      ...(mode === "idle" ? ["--when-idle", "/own", "--limit-minutes", "0"] : []),
    ]);
    assert.equal(await f.calls("publish"), "", "The shell must not control units during delegated publication");
  } finally { await f.close(); }
});

it("refuses missing revision or incomplete publication paths before delegation", async () => {
  const f = await fixture();
  try {
    const prepared = join(f.root, "prepared"), deployed = join(f.root, "dist");
    const missing = f.run("missing", {}, [prepared, deployed]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /FORGERIE_REDEPLOY_REVISION/);
    const incomplete = f.run("incomplete", { revision: "a".repeat(40) }, [prepared]);
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /both dist paths/);
    for (const index of ["missing", "incomplete"]) {
      assert.equal(await f.calls(index), "");
      assert.equal(await f.cliCalls(index), "");
    }
  } finally { await f.close(); }
});

it.each([{ mode: "immediate", code: 0 }, { mode: "idle", code: 37 }])("launches $mode from a minimal environment and retains publisher exit $code after source removal", async ({ mode, code }) => {
  const root = await mkdtemp(join(tmpdir(), "publisher-launch-"));
  try {
    // The verified source is a linked worktree, as Forgerie creates it.
    const main = join(root, "main"), source = join(root, "source"), target = join(root, "target"), bin = join(root, "bin");
    await mkdir(main); await mkdir(bin);
    const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
    assert.equal(git("init", "-q", main).status, 0);
    await writeFile(join(main, ".gitignore"), "dist/\nnode_modules\n");
    await writeFile(join(main, "package-lock.json"), "locked dependencies\n");
    await writeFile(join(main, "package.json"), '{"type":"module"}');
    assert.equal(git("-C", main, "add", ".").status, 0);
    assert.equal(git("-C", main, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "verified source").status, 0);
    assert.equal(git("-C", main, "worktree", "add", "-q", "--detach", source).status, 0);
    assert.equal(git("clone", "-q", source, target).status, 0);
    const revision = git("-C", source, "rev-parse", "HEAD").stdout.trim();
    const prepared = join(source, "dist"), deployed = join(target, "dist");
    await mkdir(prepared); await mkdir(deployed);
    const dependencies = join(root, "installed-dependencies"); await mkdir(dependencies);
    await mkdir(join(dependencies, "captured-dependency"));
    await writeFile(join(dependencies, "captured-dependency/package.json"), '{"name":"captured-dependency","main":"index.js"}');
    await writeFile(join(dependencies, "captured-dependency/index.js"), "module.exports = 'captured dependencies';");
    await symlink(dependencies, join(source, "node_modules"));
    const calls = join(root, "worker.json");
    await writeFile(join(prepared, "cli.js"), `import fs from 'node:fs'; import dependency from 'captured-dependency'; fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2), home:process.env.HOME, dependency})); process.exit(${code});\n`);
    await writeFile(join(prepared, ".forgerie-verified.json"), '{"receipt":"copied unchanged; the real CLI validates it"}');
    await writeFile(join(bin, "nix"), `#!/bin/sh\nprintf '%s\\n' "$*" > '${root}/bootstrap'\nwhile [ "$1" != --command ]; do shift; done\nshift\nexport PATH='${bin}:${process.env.PATH}'\nexec "$@"\n`, { mode: 0o755 });
    await writeFile(join(bin, "systemd-run"), `#!${process.execPath}\nrequire('node:fs').writeFileSync('${root}/launch.json', JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const args = mode === "immediate" ? ["--now", prepared, deployed, revision.slice(0, 8)] : ["/own", "0", prepared, deployed];
    const env = { HOME: root, PATH: bin, FORGERIE_REDEPLOY_REVISION: revision.slice(0, 8) };
    const launch = () => spawnSync("/bin/sh", [script, "--launch", ...args], { env, encoding: "utf8" });
    await writeFile(join(source, "untracked.txt"), "not verified");
    const dirty = launch();
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /Verified source checkout must be clean/);
    await rm(join(source, "untracked.txt"));
    assert.equal(git("-C", target, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "advanced target").status, 0);
    const stale = launch();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Deployed checkout revision differs/);
    assert.equal(git("-C", target, "checkout", "--detach", revision).status, 0);
    await assert.rejects(readFile(join(root, "launch.json")), /ENOENT/);
    const result = launch();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const removal = /Remove it with: (git -C .+ worktree remove .+)$/m.exec(result.stdout)?.[1];
    assert.equal(removal, `git -C ${main} worktree remove ${source}`, result.stdout);
    assert.match(await readFile(join(root, "bootstrap"), "utf8"), /shell.*--command bash/);
    const unitArgs = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
    const workerEnv = Object.fromEntries(unitArgs.filter(arg => arg.startsWith("--setenv=")).map(arg => { const value = arg.slice(9), at = value.indexOf("="); return [value.slice(0, at), value.slice(at + 1)]; }));
    assert.equal(workerEnv.HOME, root);
    assert.ok(workerEnv.PATH.includes(process.env.PATH));
    const worker = unitArgs.slice(unitArgs.indexOf("--") + 1);
    const receipt = worker[worker.indexOf("--run-staged") + 1];
    assert.equal(JSON.parse(await readFile(receipt, "utf8")).status, "queued");
    await writeFile(join(bin, "systemd-run"), "#!/bin/sh\nexit 19\n", { mode: 0o755 });
    const rejected = launch();
    assert.equal(rejected.status, 19);
    assert.match(rejected.stderr, /Launch failed; retained/);
    const receipts = await Promise.all((await readdir(join(target, ".forgerie"))).map(stage => readFile(join(target, ".forgerie", stage, "result.json"), "utf8").then(JSON.parse)));
    assert.ok(receipts.some(value => value.status === "failed" && value.phase === "launch" && value.exitCode === 19));
    // Run the printed command: the clean source worktree goes away before the publisher runs.
    const removed = spawnSync("bash", ["-c", removal], { encoding: "utf8" });
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(source), false);
    await rm(dependencies, { recursive: true });
    const stage = dirname(receipt), log = join(stage, "publish.log");
    // systemd appends the unit's output to publish.log.
    const output = openSync(log, "a");
    const completed = spawnSync(worker[0], worker.slice(1), { env: workerEnv, stdio: ["ignore", output, output] });
    closeSync(output);
    assert.equal(completed.status, code, readFileSync(log, "utf8"));
    const terminal = JSON.parse(await readFile(receipt, "utf8"));
    assert.deepEqual({ status: terminal.status, exitCode: terminal.exitCode, revision: terminal.revision }, { status: code === 0 ? "passed" : "failed", exitCode: code, revision });
    const call = JSON.parse(await readFile(calls, "utf8"));
    const staged = call.args[1];
    assert.notEqual(staged, prepared);
    assert.equal(dirname(staged), join(stage, "source"));
    if (code === 0) {
      // A passed publication removes the clone, build and node_modules after the publisher exits.
      assert.deepEqual((await readdir(stage)).sort(), ["publish.log", "result.json"]);
      assert.match(await readFile(log, "utf8"), /Removed the staged clone, build and node_modules; kept publish\.log and result\.json/);
    } else {
      // A failed publication keeps everything for inspection.
      assert.deepEqual((await readdir(stage)).sort(), ["launcher.sh", "publish.log", "result.json", "source"]);
      assert.equal(git("-C", join(staged, ".."), "rev-parse", "HEAD").stdout.trim(), revision);
      assert.equal(git("-C", join(staged, ".."), "status", "--porcelain").stdout.trim(), "");
      assert.ok(existsSync(join(stage, "source/node_modules/captured-dependency/index.js")));
    }
    assert.deepEqual(call.args, ["deploy", staged, deployed, revision, ...(mode === "idle" ? ["--when-idle", "/own", "--limit-minutes", "0"] : [])]);
    assert.equal(call.dependency, "captured dependencies");
    assert.equal(call.home, root);
  } finally { await rm(root, { recursive: true, force: true }); }
});
