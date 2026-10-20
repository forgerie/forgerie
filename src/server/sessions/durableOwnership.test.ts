import { execFileSync } from "node:child_process";
import { link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDurableOwnership, type DurableOwnership } from "./durableOwnership.js";

const directories: string[] = [];
const leases: DurableOwnership[] = [];
afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.release()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function database(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-owner-"));
  directories.push(directory);
  return join(directory, "state.sqlite");
}

/** The flock process that holds this test's lock, then its cat. */
function lockHolderProcesses(path: string): number[] {
  const children = (parent: number) => execFileSync("ps", ["--ppid", String(parent), "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n").flatMap((line) => { const [pid, ...args] = line.trim().split(/\s+/); return pid === undefined || pid === "" ? [] : [{ pid: Number(pid), args: args.join(" ") }]; });
  const flock = children(process.pid).find((child) => child.args.includes(`${path}.lock cat`));
  if (flock === undefined) return [];
  return [flock.pid, ...children(flock.pid).filter((child) => child.args === "cat").map((child) => child.pid)];
}

describe("Durable storage ownership", () => {
  it("rejects another owner before opening SQLite, then allows reopen after release", async () => {
    const path = await database();
    const first = await acquireDurableOwnership(path);
    leases.push(first);
    first.assertOwned();
    await expect(acquireDurableOwnership(path)).rejects.toThrow("already held");
    await first.release();
    expect(() => { first.assertOwned(); }).toThrow();
    const second = await acquireDurableOwnership(path);
    leases.push(second);
    second.assertOwned();
  });
  it("reports the signal when an acquired lock holder is killed", async () => {
    const path = await database();
    const owner = await acquireDurableOwnership(path);
    leases.push(owner);
    const [holder] = lockHolderProcesses(path);
    if (holder === undefined) throw new Error("Missing test lock holder");
    process.kill(holder, "SIGKILL");
    await expect.poll(() => { try { owner.assertOwned(); return "owned"; } catch (error) { return String(error); } }).toContain("flock exit null, signal SIGKILL");
  });
  it("keeps the lock when a service stop signals every process of the owner", async () => {
    const path = await database();
    const owner = await acquireDurableOwnership(path);
    leases.push(owner);
    const holders = lockHolderProcesses(path);
    expect(holders).toHaveLength(2);
    // KillMode=control-group: the stop signal reaches the lock holder and its cat with the daemon.
    for (const signal of ["SIGTERM", "SIGINT"] as const) for (const pid of holders) process.kill(pid, signal);
    // A dead holder would release the kernel lock before this second owner's flock runs.
    await expect(acquireDurableOwnership(path)).rejects.toThrow("already held");
    owner.assertOwned();
    await owner.release();
    expect(() => { owner.assertOwned(); }).toThrow("no longer owned");
    leases.push(await acquireDurableOwnership(path));
  });
  it("canonicalizes file symlinks and rejects hard-link aliases", async () => {
    const path = await database();
    await writeFile(path, "");
    const alias = `${path}.alias`;
    await symlink(path, alias);
    const owner = await acquireDurableOwnership(alias);
    leases.push(owner);
    expect(owner.databasePath).toBe(path);
    await expect(acquireDurableOwnership(path)).rejects.toThrow("already held");
    await owner.release();
    await link(path, `${path}.hard-link`);
    await expect(acquireDurableOwnership(path)).rejects.toThrow("hard-link aliases");
  });
  it("does not allow a symlink alias to acquire a second owner", async () => {
    const path = await database();
    const directory = directories[0];
    if (directory === undefined) throw new Error("Fixture must have a directory");
    const alias = `${directory}-alias`;
    await symlink(directory, alias);
    directories.push(alias);
    leases.push(await acquireDurableOwnership(path));
    await expect(acquireDurableOwnership(join(alias, "state.sqlite"))).rejects.toThrow("already held");
  });
});
