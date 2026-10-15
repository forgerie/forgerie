import { z } from "zod";
import { decisionGatewayKeyClearSchema, decisionGatewayKeyErrorCodeSchema, decisionGatewayKeyErrors, decisionGatewayKeySetSchema, decisionHintsStatusSchema } from "../../shared/decisionHints.js";
import type { SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { readJsonBody, refuseCrossSite, sendJson, SettingsHttpError } from "./http.js";
import type { PluginService } from "./pluginService.js";
import type { Middleware } from "./routes.js";

const upstreamError = z.object({ code: decisionGatewayKeyErrorCodeSchema });
const basePath = "/aui/plugins/decision-hints/gateway-key";
const limits = { maxBytes: 32_768, tooLarge: "Gateway key requests are limited to 32 KB.", requireJsonType: true };

/** Write-only credential API. No body, upstream error text, or schema diagnostic is logged or echoed. */
export function decisionGatewayKeyMiddleware(plugins: PluginService, daemon: SessionDaemonRequestClient): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (path !== basePath && path !== `${basePath}/clear`) { next(); return; }
    const handle = async () => {
      let body: unknown;
      if (request.method === "POST") {
        refuseCrossSite(request, "Gateway key changes must come from this settings page.");
        const input = await readJsonBody(request, limits);
        const parsed = (path.endsWith("/clear") ? decisionGatewayKeyClearSchema : decisionGatewayKeySetSchema).safeParse(input);
        if (!parsed.success) throw new SettingsHttpError(400, decisionGatewayKeyErrors.invalid.error);
        const revision = await plugins.requireRevision(parsed.data.revision);
        body = { ...parsed.data, revision };
      } else if (request.method !== "GET" || path !== basePath) {
        throw new SettingsHttpError(405, "Use GET for status or POST to change the gateway key.");
      }
      const upstream = await daemon.request(request.method ?? "GET", `/decision-hints/gateway-key${path.endsWith("/clear") ? "/clear" : ""}`, body);
      if (upstream.statusCode >= 300 && upstream.statusCode < 400) throw new SettingsHttpError(502, "Session daemon redirects are not allowed for gateway key requests.");
      const value: unknown = JSON.parse(upstream.body);
      if (upstream.statusCode !== 200) {
        const parsed = upstreamError.safeParse(value);
        const failure = decisionGatewayKeyErrors[parsed.success ? parsed.data.code : "unavailable"];
        throw new SettingsHttpError(failure.status, failure.error);
      }
      const parsed = decisionHintsStatusSchema.safeParse(value);
      if (!parsed.success) throw new SettingsHttpError(502, decisionGatewayKeyErrors.unavailable.error);
      return parsed.data;
    };
    handle().then(value => { sendJson(response, 200, value); }).catch((error: unknown) => {
      sendJson(response, error instanceof SettingsHttpError ? error.status : 502,
        { error: error instanceof SettingsHttpError ? error.message : decisionGatewayKeyErrors.unavailable.error });
    });
  };
}
