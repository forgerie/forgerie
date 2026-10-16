import { defineConfig } from "vitest/config";
import { SERIAL_LANE } from "./scripts/test-serial-lane.mjs";

const include = ["src/**/*.test.ts", "scripts/**/*.test.mjs"];

export default defineConfig({
  test: {
    // SDK acceptance tests also boot workers. Match the coverage run's budget
    // instead of starting one expensive compiler/runtime graph per host core.
    maxWorkers: 4,
    setupFiles: ["scripts/test-agent-profile.mjs"],
    // Load-sensitive files run alone, after the parallel lane: they time out when they share the CPU.
    projects: [
      { extends: true, test: { name: "parallel", include, exclude: ["**/node_modules/**", ...SERIAL_LANE], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "serial", include: [...SERIAL_LANE], fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "scripts/**/*.mjs"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.mjs",
        "**/*.testSupport.ts",
        "**/*TestSupport.ts",
        "**/*.d.ts",
        "scripts/**",
        "src/cli.ts",
        "src/piWebVersionReport.ts",
        "src/server/index.ts",
        "src/server/sessiond.ts",
      ],
      reporter: ["text-summary", "html", "json", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      // Reset on 2026-10-08 to the measured floor after the Lit client and its
      // tests left: they also exercised src/shared and parts of src/server.
      thresholds: {
        statements: 84.9,
        branches: 76.3,
        functions: 87.2,
        lines: 89.2,
        "src/shared/**/*.ts": {
          statements: 86.0,
          branches: 74.3,
          functions: 95.9,
          lines: 92.8,
        },
        "src/server/**/*.ts": {
          statements: 86.4,
          branches: 76.1,
          functions: 90.1,
          lines: 91.2,
        },
      },
    },
  },
});
