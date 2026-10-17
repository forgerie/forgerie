import { relative, resolve } from "node:path";
import { expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { SERIAL_LANE } from "./test-serial-lane.mjs";

it("discovers load-sensitive tests only in the isolated lane after ordinary tests", async () => {
  const root = resolve(import.meta.dirname, "..");
  const runner = await createVitest("test", { root, config: resolve(root, "vitest.config.ts"), watch: false });
  try {
    const loadSensitive = [
      "src/server/sessions/durableChildAutonomy.test.ts",
      "src/server/sessions/durableRiskLabels.test.ts",
    ];
    expect(SERIAL_LANE).toEqual(expect.arrayContaining(loadSensitive));
    expect(new Set(SERIAL_LANE).size).toBe(SERIAL_LANE.length);
    const specifications = await runner.globTestSpecifications([...loadSensitive, "src/shared/activity.test.ts"]);
    for (const file of loadSensitive) {
      const matches = specifications.filter((spec) => relative(root, spec.moduleId) === file);
      expect(matches, file).toHaveLength(1);
      expect(matches[0].project.name).toBe("serial");
    }
    const ordinary = specifications.find((spec) => relative(root, spec.moduleId) === "src/shared/activity.test.ts");
    expect(ordinary?.project.name).toBe("parallel");
    const serial = runner.getProjectByName("serial").config;
    const parallel = runner.getProjectByName("parallel").config;
    expect(serial.fileParallelism).toBe(false);
    expect(serial.sequence.groupOrder).toBeGreaterThan(parallel.sequence.groupOrder);
    for (const config of [serial, parallel]) {
      expect(config.isolate).toBe(true);
      expect(config.retry ?? 0).toBe(0);
      expect(config.setupFiles).toContain(resolve(root, "scripts/test-agent-profile.mjs"));
    }
  } finally {
    await runner.close();
  }
});
