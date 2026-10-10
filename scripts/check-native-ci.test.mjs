import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkNativeEnvironment } from './check-native-ci.mjs';

const native = {
  platform: 'linux',
  nodeVersion: 'v24.16.0',
  nodePath: '/nix/store/example-nodejs-24/bin/node',
  tempFilesystem: 'bcachefs',
  hostDaemonAccessible: false,
};

test('accepts a Nix-provided Node 24 with disk-backed scratch and no host daemon', () => {
  assert.doesNotThrow(() => checkNativeEnvironment(native));
});

for (const [field, value, message] of [
  ['platform', 'win32', /Linux/],
  ['nodeVersion', 'v22.19.0', /Node 24/],
  ['nodePath', '/opt/hostedtoolcache/node/24/bin/node', /Nix store/],
  ['tempFilesystem', 'tmpfs', /disk-backed/],
  ['tempFilesystem', 'ramfs', /disk-backed/],
  ['tempFilesystem', '', /disk-backed/],
  ['hostDaemonAccessible', true, /host Nix daemon/],
]) {
  test(`rejects ${field}=${value}`, () => {
    assert.throws(() => checkNativeEnvironment({ ...native, [field]: value }), message);
  });
}
