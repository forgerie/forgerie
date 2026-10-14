import assert from "node:assert/strict";
import { it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./redeploy-when-idle.sh", import.meta.url).pathname;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "redeploy-check-"));
  await writeFile(join(root, "curl"), '#!/usr/bin/env bash\nif [[ "$*" == *build.json* ]]; then printf \'{"entry":"test.js"}\\n\'; else printf "%s" "$ACTIVITY"; exit "$CURL_EXIT"; fi\n', { mode: 0o755 });
  await writeFile(join(root, "systemctl"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CALLS"\nexit "$SYSTEMCTL_EXIT"\n', { mode: 0o755 });
  return {
    root,
    run(index, item, paths = []) {
      return spawnSync("bash", [script, "/own", "0", ...paths], { encoding: "utf8", env: { ...process.env,
        FORGERIE_DEPLOY_SHELL: "1", PATH: `${root}:${process.env.PATH}`, FORGERIE_REDEPLOY_LOG: join(root, `log-${index}`),
        ACTIVITY: item.raw ?? JSON.stringify(item.activity), CURL_EXIT: String(item.curlExit ?? 0), SYSTEMCTL_EXIT: String(item.systemctlExit ?? 0), CALLS: join(root, `calls-${index}`) } });
    },
    calls: (index) => readFile(join(root, `calls-${index}`), "utf8").catch(() => ""),
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
      assert.equal((await f.calls(index)).includes("restart"), item.pass === true || item.restart === true, item.name);
    }
  } finally { await f.close(); }
});

it("publishes a prepared build while services are stopped and keeps the previous build", async () => {
  const f = await fixture();
  const prepared = join(f.root, "prepared"), deployed = join(f.root, "dist");
  try {
    for (const [path, content] of [[prepared, "new"], [deployed, "old"]]) {
      await mkdir(join(path, "server"), { recursive: true });
      await mkdir(join(path, "client"));
      await writeFile(join(path, "server/sessiond.js"), content);
      await writeFile(join(path, "server/index.js"), content);
      await writeFile(join(path, "client/build.json"), JSON.stringify({ entry: `${content}.js` }));
    }
    const idle = { activity: { workspaces: [] } };
    const refused = f.run("invalid", idle, [prepared, f.root]);
    assert.notEqual(refused.status, 0);
    assert.equal(await f.calls("invalid"), "");
    const result = f.run("publish", idle, [prepared, deployed]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual((await f.calls("publish")).trim().split("\n").slice(0, 2), [
      "--user stop forgerie-sessiond.service forgerie-web.service", "--user start forgerie-sessiond.service forgerie-web.service",
    ]);
    assert.equal(await readFile(join(deployed, "server/index.js"), "utf8"), "new");
    const [backup] = await readdir(join(f.root, ".forgerie"));
    assert.equal(await readFile(join(f.root, ".forgerie", backup, "previous/server/index.js"), "utf8"), "old");
  } finally { await f.close(); }
});
