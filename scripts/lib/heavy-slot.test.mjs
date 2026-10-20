import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireHeavySlot } from "./heavy-slot.mjs";

let directory;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it("serializes holders of one slot and releases on demand", async () => {
  directory = await mkdtemp(join(tmpdir(), "fg-heavy-slot-"));
  const first = await acquireHeavySlot(2, { directory });
  let secondAcquired = false;
  const second = acquireHeavySlot(2, { directory }).then(slot => { secondAcquired = true; return slot; });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(secondAcquired).toBe(false);
  await first.release();
  const holder = await second;
  expect(secondAcquired).toBe(true);
  await holder.release();
  await holder.release();
});

it("keeps slots independent and rejects unknown slots", async () => {
  directory = await mkdtemp(join(tmpdir(), "fg-heavy-slot-"));
  const one = await acquireHeavySlot(1, { directory });
  const two = await acquireHeavySlot(2, { directory });
  await Promise.all([one.release(), two.release()]);
  await expect(acquireHeavySlot(3, { directory })).rejects.toThrow("Heavy slot must be 1 or 2");
});
