import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it } from "vitest";

it.each([{ mode: "journal", flags: [] }, { mode: "daemon", flags: ["--daemon"] }])("reports unavailable user-systemd as UNVERIFIED, never passed ($mode)", async ({ flags }) => {
  const directory = await mkdtemp(join(tmpdir(), "restart-unavailable-"));
  try {
    const calls = join(directory, "calls");
    await writeFile(join(directory, "systemctl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nexit 1\n`, { mode: 0o755 });
    await assert.rejects(promisify(execFile)(process.execPath, ["scripts/verify-durable-session-restart.mjs", ...flags], {
      env: { ...process.env, PATH: directory },
    }), error => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /UNVERIFIED: .*requires Linux user-systemd/);
      assert.doesNotMatch(error.stdout + error.stderr, /PASS:/);
      return true;
    });
    assert.equal(await readFile(calls, "utf8"), "--user show-environment\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
