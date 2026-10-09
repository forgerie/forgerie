import { join } from "node:path";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";

/** Serializes process-wide PI_OFFLINE windows during runtime construction. */
let offlineRuntimeCreations: Promise<unknown> = Promise.resolve();

/**
 * Create the shared model runtime with runtime-owned network refreshes disabled.
 *
 * Upstream `ModelRuntime.refresh()`, `login()`, and `logout()` always refresh
 * with `allowNetwork: modelNetworkEnabled` by default, and `login()`/`logout()`
 * accept no abort signal. With the default (`PI_OFFLINE` unset) a single stalled
 * provider-catalog fetch can block those call paths for minutes — and, because
 * Forgerie shares one runtime and pi coalesces per-provider refreshes, session
 * creation joins the same stalled fetch. Forcing `PI_OFFLINE` during construction makes every runtime-driven
 * refresh local-only; Forgerie performs its own bounded catalog refreshes in the
 * background instead (see modelCatalogRefresher.ts).
 *
 * `modelNetworkEnabled` is computed once from the environment inside
 * `ModelRuntime.create()`, so the env var is the only lever upstream exposes.
 * Calls are queued so their env windows never overlap.
 */
function createOfflineModelRuntime(options: CreateModelRuntimeOptions): Promise<ModelRuntime> {
  const created = offlineRuntimeCreations.then(() => forceOfflineWhile(() => ModelRuntime.create(options)));
  // A failed creation must not poison the queue; the caller still sees the rejection.
  offlineRuntimeCreations = created.then(() => undefined, () => undefined);
  return created;
}

/**
 * Force `PI_OFFLINE` for the duration of `create`, then restore what was there.
 *
 * `process.env` is process-wide, so this window is a real global side effect:
 * anything reading `PI_OFFLINE` while `create` awaits observes offline mode,
 * including upstream's package manager, tools manager, and version check. That
 * is acceptable because Forgerie only builds runtimes during daemon startup and in
 * tests, and the window is one `ModelRuntime.create()` call — but it is why
 * callers must stay serialized rather than run concurrently.
 */
async function forceOfflineWhile<T>(create: () => Promise<T>): Promise<T> {
  const previous = process.env["PI_OFFLINE"];
  process.env["PI_OFFLINE"] = "1";
  try {
    return await create();
  } finally {
    if (previous === undefined) delete process.env["PI_OFFLINE"];
    else process.env["PI_OFFLINE"] = previous;
  }
}

export function createModelRuntimeForAgentDir(agentDir: string): Promise<ModelRuntime> {
  return createOfflineModelRuntime({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
}
