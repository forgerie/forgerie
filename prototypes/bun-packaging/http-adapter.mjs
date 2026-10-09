// Throwaway experiment only. Call explicitly before loading the private daemon build.
import undici from '../../node_modules/undici/index.js';

export function installHttpAdapter(mode) {
  if (mode === 'fetch') globalThis.fetch = undici.fetch;
  else if (mode === 'install') undici.install();
  else if (mode !== 'dispatcher') throw new Error(`Unknown adapter mode: ${mode}`);
  return { mode, fetchIsInstalled: globalThis.fetch === undici.fetch,
    responseIsInstalled: globalThis.Response === undici.Response,
    websocketIsInstalled: globalThis.WebSocket === undici.WebSocket };
}

export { undici };
