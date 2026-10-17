import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveConfig } from "vitest/node";
import browserConfig from "../vite.config";

// Use the shipped policy without bundling the dev-server plugin graph a second time.
const root = resolve(import.meta.dirname, "..");

// Probe the repository default, not a worker override inherited by this run.
beforeEach(() => { vi.stubEnv("VITEST_MAX_WORKERS", ""); });
afterEach(() => { vi.unstubAllEnvs(); });

test("browser tests default to two isolated workers without retries", async () => {
  const config = await resolveConfig({ root, config: false }, { test: browserConfig.test });
  expect(config.test?.maxWorkers).toBe(2);
  expect(config.test?.isolate).toBe(true);
  expect(config.test?.retry ?? 0).toBe(0);
  expect(config.test?.setupFiles).toContain(resolve(root, "src/testSetup.ts"));
});

test("an explicit worker budget overrides the browser default", async () => {
  const config = await resolveConfig({ root, config: false, maxWorkers: 4 }, { test: browserConfig.test });
  expect(config.test?.maxWorkers).toBe(4);
});
