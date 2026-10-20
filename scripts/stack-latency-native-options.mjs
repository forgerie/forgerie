import assert from "node:assert/strict";
import { isAbsolute, join, resolve } from "node:path";

export function nativeFixtureOptions(args) {
  const [root, rawPort, clientDist, sizes = "20,300"] = args;
  assert.ok(root && isAbsolute(root) && resolve(root).startsWith("/tmp/") && resolve(root) !== "/tmp", "A fresh absolute /tmp fixture root is required");
  const port = Number(rawPort);
  assert.ok(Number.isInteger(port) && port >= 18641 && port <= 18656, "Use an assigned loopback fixture port (18641–18656)");
  assert.ok(clientDist && isAbsolute(clientDist), "An absolute built client directory is required");
  const turns = sizes.split(",").map(Number);
  assert.ok(turns.length >= 2 && turns.length <= 8 && turns.every(n => Number.isInteger(n) && n > 0 && n <= 1500), "Supply 2–8 histories, each 1–1500 turns");
  return { root: resolve(root), port, clientDist: resolve(clientDist), turns };
}

export function fixtureEnvironment(root, inherited = process.env) {
  return { PATH: inherited.PATH ?? "/usr/bin:/bin", HOME: root, LANG: "C.UTF-8",
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "share"),
    PI_CODING_AGENT_DIR: join(root, "profile"), PI_WEB_DATA_DIR: join(root, "data"),
    PI_WEB_CONFIG: join(root, "config.json"), PI_WEB_SESSIOND_SOCKET: join(root, "sessiond.sock"), PI_OFFLINE: "1" };
}
