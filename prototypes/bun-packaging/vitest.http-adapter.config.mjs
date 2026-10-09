import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

export default mergeConfig(base, defineConfig({
  // Match the private build's exact npm import only in Bun workers.
  resolve: { alias: process.versions.bun ? [{ find: /^undici$/,
    replacement: fileURLToPath(new URL('../../node_modules/undici/index.js', import.meta.url)) }] : [] },
  test: { setupFiles: ['prototypes/bun-packaging/runtime-http-adapter-setup.mjs'], maxWorkers: 2 },
}));
