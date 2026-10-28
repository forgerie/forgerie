import { expect, it } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { childModelDiagnostic, childModelDiagnosticContext, childModelDiagnosticReport, hasUnsafeChildModelDiagnostic } from "./childModelDiagnostic.js";

it.each([
  ["Incorrect API key provided: sk-review-fixture-SECRET", "sk-review-fixture-SECRET"],
  ["Invalid credentials sk-ant-api03-review-fixture-SECRET", "sk-ant-api03-review-fixture-SECRET"],
  ["Authorization: Bearer private-fixture-secret", "private-fixture-secret"],
  ["api_key=private-fixture-secret", "private-fixture-secret"],
  ['"api-key": "private-fixture-secret"', "private-fixture-secret"],
  ["apikey:private-fixture-secret", "private-fixture-secret"],
  ["api_key='private fixture secret'", "private fixture secret"],
  [`opaque: ${"ABc9+/".repeat(10)}`, "ABc9+/".repeat(10)],
  [`opaque: ${"abcdef0123456789".repeat(3)}`, "abcdef0123456789".repeat(3)],
  ["HTTP 429 https://api.example.test/v1?token=private-fixture-secret&other=hidden", "private-fixture-secret"],
  ["WebSocket closed: wss://api.example.test/v1?token=private-fixture-secret", "private-fixture-secret"],
])("redacts provider diagnostics: %s", (error, secret) => {
  const diagnostic = childModelDiagnostic(error);
  expect(diagnostic).not.toContain(secret); expect(diagnostic).toMatch(/\[redacted\]|^invalid credentials$/);
  expect(diagnostic.length).toBeLessThanOrEqual(300); expect(childModelDiagnostic(diagnostic)).toBe(diagnostic);
});
it("redacts before truncation and normalizes control characters", () => {
  const diagnostic = childModelDiagnostic(`${"safe context ".repeat(22)}api_key=private-fixture-secret ${"safe context ".repeat(30)}\n\u001b`);
  expect(diagnostic).not.toContain("private-fixture"); expect(diagnostic.length).toBeLessThanOrEqual(300);
  expect(childModelDiagnostic("HTTP 429\n\u001b\u202e rate limit")).toBe("HTTP 429 rate limit");
});
it("scrubs SDK error context and old retry prompts without changing a user's task", () => {
  const secret = "sk-review-fixture-SECRET";
  const messages = [fauxAssistantMessage(secret, { stopReason: "error", errorMessage: `Incorrect API key provided: ${secret}` }),
    { role: "user" as const, content: `Continue where you stopped; the last request failed with: ${secret}`, timestamp: 1 }];
  expect(JSON.stringify(childModelDiagnosticContext(messages))).not.toContain(secret);
  expect(hasUnsafeChildModelDiagnostic(messages)).toBe(true);
  expect(hasUnsafeChildModelDiagnostic(childModelDiagnosticContext(messages))).toBe(false);
  expect(messages[0]).toHaveProperty("errorMessage", `Incorrect API key provided: ${secret}`);
  expect(childModelDiagnosticContext([{ role: "user", content: "Original task", timestamp: 1 }])).toEqual([{ role: "user", content: "Original task", timestamp: 1 }]);
});

it("scrubs pending legacy reports without truncating their legitimate child answer", () => {
  const secret = "sk-review-fixture-SECRET";
  expect(childModelDiagnosticReport(`[subagent worker failed: model_error: Incorrect API key provided: ${secret}]`)).not.toContain(secret);
  const answer = "Legitimate child answer. ".repeat(40);
  const oldReport = `[subagent worker answered (ran on b/two after a/one: Incorrect API key provided: ${secret}), no reply needed] ${answer}`;
  const report = childModelDiagnosticReport(oldReport);
  expect(report).not.toContain(secret); expect(report).toContain(answer);
});

it("bounds adversarial megabyte inputs before regex processing", () => {
  const adversarial = "a.".repeat(512 * 1024);
  const start = performance.now();
  const diagnostic = childModelDiagnostic(adversarial);
  expect(performance.now() - start).toBeLessThan(50);
  expect(diagnostic.length).toBeLessThanOrEqual(300);
});
it.each([
  `${"complete context ".repeat(250)}api_key="private fixture secret ${"x".repeat(5000)}`,
  `${"complete context ".repeat(250)}sk-review-fixture-${"X".repeat(5000)}`,
  `${"complete context ".repeat(250)}https://example.test?token=private-fixture-secret${"X".repeat(5000)}`,
])("does not expose a credential clipped at the input boundary", (error) => {
  const diagnostic = childModelDiagnostic(error);
  expect(diagnostic).not.toContain("private"); expect(diagnostic).not.toContain("sk-review");
});

it.each(["Invalid API key: private-fixture-secret", "Incorrect API key provided: private-fixture-secret", "Authentication failed: private-fixture-secret", "Invalid credentials: private-fixture-secret"])("uses a category-only diagnostic for credential failures: %s", (error) => {
  expect(childModelDiagnostic(error)).toBe("invalid credentials");
});
it.each(["Request failed: key: private-fixture-secret", "Request failed: key private-fixture-secret", "Request failed: provided: private-fixture-secret", "Request failed: token: private-fixture-secret", "Request failed: token private-fixture-secret", "Request failed: password: private-fixture-secret", "Request failed: password private-fixture-secret"])("scrubs labelled tokens in other diagnostics: %s", (error) => { expect(childModelDiagnostic(error)).not.toContain("private-fixture-secret"); });
