import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";

it("persists shared cooldowns across restarts, serializes writers and never shortens a reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-model-cooldowns-"));
  try {
    const path = join(root, "cooldowns.json"); const errors: unknown[] = [];
    const registry = new ModelCooldownRegistry(path, (error) => { errors.push(error); });
    expect(await registry.snapshot()).toEqual({});
    await Promise.all([registry.mark("a/one", 2000, "quota"), registry.mark("b/two", 3000, "429"), registry.mark("a/one", 1000, "older")]);
    expect(await new ModelCooldownRegistry(path, (error) => { errors.push(error); }).snapshot()).toEqual({ "a/one": { until: 2000, reason: "quota" }, "b/two": { until: 3000, reason: "429" } });
    const copy = await registry.snapshot(); delete copy["a/one"];
    expect(await registry.snapshot()).toHaveProperty("a/one");
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty("b/two");
    expect(errors).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it.each(["not JSON", '{"a/one":{"until":"tomorrow","reason":"quota"}}'])("logs a corrupt registry and starts without cooldowns", async (text) => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-model-cooldowns-"));
  try {
    const path = join(root, "cooldowns.json"); await writeFile(path, text); const errors: unknown[] = [];
    const registry = new ModelCooldownRegistry(path, (error) => { errors.push(error); });
    expect(await registry.snapshot()).toEqual({}); expect(errors).toHaveLength(1);
    await registry.mark("b/two", 3000, "429");
    expect(await new ModelCooldownRegistry(path, (error) => { errors.push(error); }).snapshot()).toEqual({ "b/two": { until: 3000, reason: "429" } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("redacts new cooldown reasons and old on-disk reasons before another session can read them", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-model-cooldowns-"));
  try {
    const path = join(root, "cooldowns.json"); const secret = "sk-review-fixture-SECRET";
    const registry = new ModelCooldownRegistry(path, () => undefined);
    await registry.mark("a/one", 2000, `Incorrect API key provided: ${secret}`);
    expect(await readFile(path, "utf8")).not.toContain(secret);
    await writeFile(path, JSON.stringify({ "a/one": { until: 3000, reason: `Incorrect API key provided: ${secret}` } }));
    expect(JSON.stringify(await new ModelCooldownRegistry(path, () => undefined).snapshot())).not.toContain(secret);
  } finally { await rm(root, { recursive: true, force: true }); }
});
