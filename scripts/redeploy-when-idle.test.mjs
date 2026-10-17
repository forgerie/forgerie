import assert from "node:assert/strict";
import { it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
