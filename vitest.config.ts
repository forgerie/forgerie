import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "pi-web-plugins/**/*.ts", "scripts/**/*.mjs"],
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
      thresholds: {
        statements: 84.9,
        branches: 76.5,
        functions: 87.2,
        lines: 89.2,
        "src/shared/**/*.ts": {
          statements: 91.5,
          branches: 86.6,
          functions: 95.9,
          lines: 98.2,
        },
        "src/server/**/*.ts": {
          statements: 86.5,
          branches: 76.2,
          functions: 91.1,
          lines: 91.2,
        },
        "src/nativeServices/**/*.ts": {
          statements: 85.3,
          branches: 72.2,
          functions: 90.7,
          lines: 88.8,
        },
        "pi-web-plugins/**/*.ts": {
          statements: 91.4,
          branches: 81.7,
          functions: 97.2,
          lines: 95.3,
        },
      },
    },
  },
});
