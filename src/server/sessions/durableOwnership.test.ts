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
