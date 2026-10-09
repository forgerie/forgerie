import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

export default mergeConfig(base, defineConfig({
  test: {
    setupFiles: ['prototypes/bun-packaging/runtime-setup.mjs'],
    maxWorkers: 2,
  },
}));
