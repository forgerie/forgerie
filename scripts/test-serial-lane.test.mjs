import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { SERIAL_LANE } from "./test-serial-lane.mjs";

it.each([true, false])("executes the parallel lane before the serial lane (file parallelism: %s)", async fileParallelism => {
  const root = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "forgerie-lane-order-"));
  const trace = join(directory, "order");
  let runner;
  try {
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    const config = join(directory, "vitest.config.mjs");
    await writeFile(config, `
      import source from ${JSON.stringify(pathToFileURL(join(root, "vitest.config.ts")).href)};
      export default { ...source, test: { ...source.test, setupFiles: [], projects: source.test.projects.map(project => ({
        ...project, test: { ...project.test, include: [project.test.name + ".test.mjs"], exclude: [] }
      })) } };
    `);
    for (const lane of ["parallel", "cli", "serial"]) {
      await writeFile(join(directory, `${lane}.test.mjs`), `
        import { appendFileSync } from "node:fs";
        import { it } from "vitest";
        it("records its lane", () => appendFileSync(${JSON.stringify(trace)}, ${JSON.stringify(lane + "\n")}));
      `);
    }
    runner = await createVitest("test", { root: directory, config, watch: false, reporters: ["dot"],
      ...(fileParallelism ? {} : { fileParallelism: false }) });
    await runner.start();
    const order = (await readFile(trace, "utf8")).trim().split("\n");
    expect(order).toHaveLength(3);
    expect(order.at(-1)).toBe("serial");
    expect(order.slice(0, -1).sort()).toEqual(["cli", "parallel"]);
  } finally {
    await runner?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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
    const cliFiles = ["src/deployment.test.ts", "scripts/redeploy-when-idle.test.mjs"];
    const specifications = await runner.globTestSpecifications([...loadSensitive, ...cliFiles, "src/shared/activity.test.ts"]);
    for (const file of loadSensitive) {
      const matches = specifications.filter((spec) => relative(root, spec.moduleId) === file);
      expect(matches, file).toHaveLength(1);
      expect(matches[0].project.name).toBe("serial");
    }
    const ordinary = specifications.find((spec) => relative(root, spec.moduleId) === "src/shared/activity.test.ts");
    expect(ordinary?.project.name).toBe("parallel");
    for (const file of cliFiles) {
      const matches = specifications.filter(spec => relative(root, spec.moduleId) === file);
      expect(matches, file).toHaveLength(1);
      expect(matches[0].project.name).toBe("cli");
    }
    const serial = runner.getProjectByName("serial").config;
    const parallel = runner.getProjectByName("parallel").config;
    const cli = runner.getProjectByName("cli").config;
    expect(cli.testTimeout).toBe(15_000);
    expect(parallel.testTimeout).toBe(5000);
    expect(serial.testTimeout).toBe(5000);
    expect(cli.maxWorkers).toBe(parallel.maxWorkers);
    expect(cli.sequence.groupOrder).toBe(parallel.sequence.groupOrder);
    expect(serial.fileParallelism).toBe(false);
    expect(serial.sequence.groupOrder).toBeGreaterThan(parallel.sequence.groupOrder);
    for (const config of [serial, parallel, cli]) {
      expect(config.isolate).toBe(true);
      expect(config.retry ?? 0).toBe(0);
      expect(config.setupFiles).toContain(resolve(root, "scripts/test-agent-profile.mjs"));
    }
  } finally {
    await runner.close();
  }
});
