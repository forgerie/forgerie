import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type OAuthCredential } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

const PROVIDER_ID = "signal-required-oauth";

describe("extension OAuth compatibility", () => {
  it("forwards a bounded signal when an extension refreshes an expired credential", async () => {
    const credentials = new InMemoryCredentialStore();
    const expired: OAuthCredential = {
      type: "oauth",
      access: "expired-access",
      refresh: "refresh-token",
      expires: 0,
    };
    await credentials.modify(PROVIDER_ID, () => Promise.resolve(expired));
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
    let refreshSignal: AbortSignal | undefined;
    runtime.registerProvider(PROVIDER_ID, {
      name: "Signal-required OAuth",
      baseUrl: "https://oauth-provider.example.com",
      api: "openai-completions",
      models: [{
        id: "signal-model",
        name: "Signal model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_000,
        maxTokens: 100,
      }],
      oauth: {
        name: "Signal-required OAuth",
        login: () => Promise.reject(new Error("login should not run")),
        refreshToken: (credential, signal) => {
          refreshSignal = signal;
          return Promise.resolve({ ...credential, expires: Date.now() + 60 * 60 * 1_000 });
        },
        getApiKey: (credential) => credential.access,
      },
    });

    await expect(runtime.getAuth(PROVIDER_ID)).resolves.toMatchObject({
      auth: { apiKey: "expired-access" },
      source: "OAuth",
    });
    expect(refreshSignal).toBeInstanceOf(AbortSignal);
  });
});
