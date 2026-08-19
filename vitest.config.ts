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
        "src/client/src/main.ts",
        "src/server/index.ts",
        "src/server/sessiond.ts",
      ],
      reporter: ["text-summary", "html", "json", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      thresholds: {
        statements: 82.8,
        branches: 74.4,
        functions: 84.2,
        lines: 87,
        "src/shared/**/*.ts": {
          statements: 91.5,
          branches: 86.6,
          functions: 95.9,
          lines: 98.2,
        },
        "src/server/**/*.ts": {
          statements: 86.1,
          branches: 75.9,
          functions: 90.8,
          lines: 90.9,
        },
        "src/client/src/components/**/*.ts": {
          statements: 74.5,
          branches: 67.5,
          functions: 70.5,
          lines: 77.7,
        },
        "src/nativeServices/**/*.ts": {
          statements: 85.3,
          branches: 72.2,
          functions: 90.7,
          lines: 88.8,
        },
        "pi-web-plugins/**/*.ts": {
          statements: 87.5,
          branches: 74.8,
          functions: 86.2,
          lines: 90.9,
        },
      },
    },
  },
});
