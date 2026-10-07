export const DEFAULT_AUI_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]", "zao"];

export function speechProxyRequestHeaders(path: string | undefined, incoming: Record<string, string | string[] | undefined>, allowedHosts: readonly string[] = DEFAULT_AUI_ALLOWED_HOSTS): { host: string; origin: string } | undefined {
  const host = incoming.host;
  const authority = incoming[":authority"];
  const origin = incoming.origin;
  const site = incoming["sec-fetch-site"];
  if ([host, authority, origin, site].some(Array.isArray)) return undefined;
  if (host && authority && host !== authority) return undefined;
  return speechProxyHeaders(path,
    typeof host === "string" ? host : typeof authority === "string" ? authority : undefined,
    typeof origin === "string" ? origin : undefined,
    typeof site === "string" ? site : undefined, allowedHosts);
}

/** Only forward a browser's same-origin speech request under the trusted backend origin.
 * The dev app has a different port; untrusted origins must reach the backend guard unchanged.
 */
export function speechProxyHeaders(path: string | undefined, host: string | undefined, origin: string | undefined, site: string | undefined, allowedHosts: readonly string[] = DEFAULT_AUI_ALLOWED_HOSTS): { host: string; origin: string } | undefined {
  if (!path?.startsWith("/api/speech/") || !host || !origin) return undefined;
  if (site !== undefined && site !== "same-origin" && site !== "none") return undefined;
  try {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.host !== host) return undefined;
    if (!allowedHosts.includes(url.hostname)) return undefined;
    return { host: "127.0.0.1:8504", origin: "http://127.0.0.1:8504" };
  } catch { return undefined; }
}
