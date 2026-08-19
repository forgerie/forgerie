import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthProvidersResponse, AuthType, OAuthFlowState } from "../../shared/apiTypes.js";
import { registerAuthRoutes, type AuthRouteService } from "./authRoutes.js";

let app: FastifyInstance;
let auth: RecordingAuthRouteService;

beforeEach(async () => {
  app = Fastify({ logger: false });
  auth = new RecordingAuthRouteService();
  registerAuthRoutes(app, auth, "/api");
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("auth routes", () => {
  it("forwards provider filters and defaults the mode to login", async () => {
    const defaultResponse = await app.inject({ method: "GET", url: "/api/auth/providers" });
    const logoutResponse = await app.inject({ method: "GET", url: "/api/auth/providers?mode=logout&authType=api_key" });

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toEqual({ providers: [] });
    expect(logoutResponse.statusCode).toBe(200);
    expect(auth.providerCalls).toEqual([
      { mode: "login", authType: undefined },
      { mode: "logout", authType: "api_key" },
    ]);
  });

  it("forwards login, logout, flow response, and cancellation inputs", async () => {
    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/api/auth/api-key/interactive", payload: { providerId: "anthropic" } }),
      app.inject({ method: "POST", url: "/api/auth/logout", payload: { providerId: "openai" } }),
      app.inject({ method: "POST", url: "/api/auth/oauth", payload: { providerId: "github" } }),
      app.inject({ method: "GET", url: "/api/auth/oauth/flow-1" }),
      app.inject({ method: "POST", url: "/api/auth/oauth/flow-1/respond", payload: { requestId: "request-1", value: "code" } }),
      app.inject({ method: "POST", url: "/api/auth/oauth/flow-1/cancel" }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(auth.calls).toHaveLength(6);
    expect(auth.calls).toEqual(expect.arrayContaining([
      "api-key:anthropic",
      "logout:openai",
      "oauth:github",
      "flow:flow-1",
      "respond:flow-1:request-1:code",
      "cancel:flow-1",
    ]));
    expect(responses[1].json()).toEqual({ accepted: true });
    expect(responses[4].json()).toMatchObject({ flowId: "flow-1", status: "running" });
  });

  it.each([
    { method: "GET", url: "/api/auth/providers", expectedStatus: 404 },
    { method: "POST", url: "/api/auth/api-key/interactive", payload: { providerId: "anthropic" }, expectedStatus: 400 },
    { method: "POST", url: "/api/auth/logout", payload: { providerId: "anthropic" }, expectedStatus: 400 },
    { method: "POST", url: "/api/auth/oauth", payload: { providerId: "anthropic" }, expectedStatus: 400 },
    { method: "GET", url: "/api/auth/oauth/flow-1", expectedStatus: 404 },
    { method: "POST", url: "/api/auth/oauth/flow-1/respond", payload: { requestId: "request-1", value: "code" }, expectedStatus: 400 },
    { method: "POST", url: "/api/auth/oauth/flow-1/cancel", expectedStatus: 400 },
  ] as const)("maps $method $url failures to $expectedStatus", async ({ method, url, payload, expectedStatus }) => {
    auth.failure = new Error("auth unavailable");

    const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });

    expect(response.statusCode).toBe(expectedStatus);
    expect(response.json()).toEqual({ error: "auth unavailable" });
  });
});

class RecordingAuthRouteService implements AuthRouteService {
  readonly calls: string[] = [];
  readonly providerCalls: { mode: "login" | "logout"; authType: AuthType | undefined }[] = [];
  failure: Error | undefined;

  authProviders(mode: "login" | "logout", authType?: AuthType): Promise<AuthProvidersResponse> {
    this.raiseFailure();
    this.providerCalls.push({ mode, authType });
    return Promise.resolve({ providers: [] });
  }

  startApiKeyLogin(providerId: string): Promise<OAuthFlowState> {
    this.raiseFailure();
    this.calls.push(`api-key:${providerId}`);
    return Promise.resolve(flow(providerId));
  }

  logoutProvider(providerId: string): Promise<{ accepted: true }> {
    this.raiseFailure();
    this.calls.push(`logout:${providerId}`);
    return Promise.resolve({ accepted: true });
  }

  startOAuthLogin(providerId: string): Promise<OAuthFlowState> {
    this.raiseFailure();
    this.calls.push(`oauth:${providerId}`);
    return Promise.resolve(flow(providerId));
  }

  oauthFlow(flowId: string): OAuthFlowState {
    this.raiseFailure();
    this.calls.push(`flow:${flowId}`);
    return flow("anthropic", flowId);
  }

  respondToOAuthFlow(flowId: string, requestId: string, value: string): OAuthFlowState {
    this.raiseFailure();
    this.calls.push(`respond:${flowId}:${requestId}:${value}`);
    return flow("anthropic", flowId);
  }

  cancelOAuthFlow(flowId: string): OAuthFlowState {
    this.raiseFailure();
    this.calls.push(`cancel:${flowId}`);
    return { ...flow("anthropic", flowId), status: "cancelled" };
  }

  private raiseFailure(): void {
    if (this.failure !== undefined) throw this.failure;
  }
}

function flow(providerId: string, flowId = "flow-1"): OAuthFlowState {
  return {
    flowId,
    providerId,
    providerName: providerId,
    status: "running",
    progress: [],
  };
}
