import { describe, expect, it } from "vitest";
import { redactRiskLabelArguments, redactRiskLabelText } from "./riskLabelRedaction.js";

describe("outbound risk-label redaction", () => {
  it.each([
    ['curl -H "Authorization: Bearer short-secret" https://api.example.test/items', 'curl -H "Authorization: Bearer [redacted]" https://api.example.test/items'],
    ["curl -H 'authorization: Basic dXNlcjpwYXNz' https://api.example.test", "curl -H 'authorization: Basic [redacted]' https://api.example.test"],
    ['deploy --token="short secret" --password hunter2 --dry-run', 'deploy --token="[redacted]" --password [redacted] --dry-run'],
    ["deploy --api-key 'abc def' --access-token=short --secret=hidden", "deploy --api-key '[redacted]' --access-token=[redacted] --secret=[redacted]"],
    ['API_KEY="short secret" GH_TOKEN=gh-secret KEY=hidden NODE_ENV=production npm publish --dry-run', 'API_KEY="[redacted]" GH_TOKEN=[redacted] KEY=[redacted] NODE_ENV=production npm publish --dry-run'],
    ["env DATABASE_PASSWORD='ab'\"cd\" service --verbose", "env DATABASE_PASSWORD=[redacted] service --verbose"],
    ['curl https://user:p%40ss@host.example.test/path?token=short&limit=2', 'curl https://[redacted]@host.example.test/path?token=[redacted]&limit=2'],
    ['psql postgres://user:password@localhost/app -c "DROP TABLE items"', 'psql postgres://[redacted]@localhost/app -c "DROP TABLE items"'],
    ["curl -d '{\"password\":\"short secret\",\"name\":\"hello\"}' https://api.example.test", "curl -d '{\"password\":\"[redacted]\",\"name\":\"hello\"}' https://api.example.test"],
    ['echo sk-proj-AbC123def456GHI789jkl012MNO345pqr678 ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'echo [redacted] [redacted]'],
    ['echo xoxb-123456789012-123456789012-abcDEFghijklMNOPqrstuvWX AKIAIOSFODNN7EXAMPLE ASIA1234567890ABCDEF', 'echo [redacted] [redacted] [redacted]'],
    ['printf %s wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'printf %s [redacted]'],
  ])("redacts credentials but preserves command structure: %s", (command, expected) => {
    expect(redactRiskLabelText(command)).toBe(expected);
    expect(redactRiskLabelText(expected)).toBe(expected);
  });

  it.each([
    "cd /home/user/project/.worktrees/c-22d4c1cf3451198ff2aad74e6fcd3d6596d3fde33ae027a1cc2ded7d01503b47 && git status",
    "git push --force-with-lease origin feature/risk-labels",
    "git show 0123456789abcdef0123456789abcdef01234567 --stat",
    "git diff 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123",
    'NODE_ENV=production LOG_LEVEL=debug npm test -- --run src/server/decisions/riskLabels.test.ts',
    "curl -I https://api.example.test/items?limit=100",
    "find ./src -name '*.ts' -print | head -20",
    "echo --token-count 123 --password-policy strict",
    "printf '%s\\n' public-information-with-a-long-but-readable-name",
  ])("keeps non-secret command text unchanged: %s", command => {
    expect(redactRiskLabelText(command)).toBe(command);
  });

  it("redacts nested gate arguments without mutating their saved values", () => {
    const headers = Object.freeze({Authorization: "Bearer short-secret", Accept: "application/json"});
    const args = Object.freeze({headers, password: "short", apiKey: "short-key", env: Object.freeze({AWS_SECRET_ACCESS_KEY: "short-aws-secret", NODE_ENV: "production"}),
      targets: Object.freeze(["https://user:pass@host.test/data", 7, null]), message: "Publish updated listing"});
    const original = JSON.stringify(args);
    expect(JSON.parse(redactRiskLabelArguments(args))).toEqual({headers: {Authorization: "[redacted]", Accept: "application/json"}, password: "[redacted]", apiKey: "[redacted]",
      env: {AWS_SECRET_ACCESS_KEY: "[redacted]", NODE_ENV: "production"}, targets: ["https://[redacted]@host.test/data", 7, null], message: "Publish updated listing"});
    expect(JSON.stringify(args)).toBe(original);
  });
});
