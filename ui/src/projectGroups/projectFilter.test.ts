import { describe, expect, it } from "vitest";
import { FILTER_KEY, filterEntries, filterScope, LEGACY_GROUP_KEY, liveChoices, readChoices, writeChoices } from "./projectFilter";
import { filterCatalog } from "./fixtures/groups";

/** A storage that holds its values in a map, as localStorage does. */
const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};

describe("filter entries", () => {
  it("offers every group, then the projects in no group by name; a grouped project is not offered on its own", () => {
    expect(filterEntries(filterCatalog).map(({ value, label, detail, title }) => [value, label, detail, title])).toEqual([
      ["group:kori", "KORI", "2 projects", "KORI"],
      ["group:tools", "Tools", "2 projects", "Tools"],
      ["project:irori", "Irori", "", "/code/irori"],
      ["project:pyxis", "pyxis", "", "/code/pyxis"],
    ]);
  });

  it("offers every project, by name, when there is no group", () => {
    expect(filterEntries({ groups: [], projects: filterCatalog.projects }).map((entry) => entry.value))
      .toEqual(["project:caliper", "project:irori", "project:core", "project:plugins", "project:pyxis"]);
  });
});

describe("filter scope", () => {
  const entries = filterEntries(filterCatalog);
  it("is every project when nothing is chosen", () => {
    expect(filterScope(liveChoices(entries, []))).toBeUndefined();
  });

  it("is the union of the chosen entries' projects, each once", () => {
    expect(filterScope(liveChoices(entries, ["group:kori", "group:tools", "project:pyxis"]))).toEqual(["core", "plugins", "caliper", "pyxis"]);
  });

  it("ignores a chosen group or project that no longer exists, and is every project when none is left", () => {
    expect(filterScope(liveChoices(entries, ["group:gone", "project:irori"]))).toEqual(["irori"]);
    // `core` is in a group now, so it is no longer an entry of its own.
    expect(filterScope(liveChoices(entries, ["group:gone", "project:core"]))).toBeUndefined();
  });
});

describe("stored choices", () => {
  it("round-trips the chosen entries, and clearing them removes the key", () => {
    const storage = memoryStorage();
    writeChoices(storage, ["group:kori", "project:pyxis"]);
    expect(readChoices(storage)).toEqual(["group:kori", "project:pyxis"]);
    writeChoices(storage, []);
    expect(storage.values.has(FILTER_KEY)).toBe(false);
    expect(readChoices(storage)).toEqual([]);
  });

  it("reads the old single group as the one choice, and drops the old key on the next write", () => {
    const storage = memoryStorage({ [LEGACY_GROUP_KEY]: "kori" });
    expect(readChoices(storage)).toEqual(["group:kori"]);
    writeChoices(storage, ["group:kori", "project:irori"]);
    expect(storage.values.has(LEGACY_GROUP_KEY)).toBe(false);
    expect(readChoices(storage)).toEqual(["group:kori", "project:irori"]);
  });

  it("prefers the new key over the old one, and reads a damaged value as no choice", () => {
    expect(readChoices(memoryStorage({ [FILTER_KEY]: '["project:pyxis"]', [LEGACY_GROUP_KEY]: "kori" }))).toEqual(["project:pyxis"]);
    expect(readChoices(memoryStorage({ [FILTER_KEY]: "{not json" }))).toEqual([]);
    expect(readChoices(memoryStorage({ [FILTER_KEY]: '{"group":"kori"}' }))).toEqual([]);
  });
});
