import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Bundled Pi extensions use getAgentDir(), not the loader's agentDir argument.
// Each test file gets an empty profile and no ambient proxy credential.
const profile = mkdtempSync(join(tmpdir(), "forgerie-test-agent-"));
process.env.PI_CODING_AGENT_DIR = profile;
process.env.CLIPROXYAPI_API_KEY = "";
process.env.CLIPROXYAPI_BASE_URL = "";
afterAll(() => { rmSync(profile, { recursive: true, force: true }); });
