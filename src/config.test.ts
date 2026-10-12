import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS, DEFAULT_MAX_UPLOAD_BYTES, DEFAULT_UPLOADS_FOLDER, agentDirEnvSource, agentSessionDirEnvKeys, askUserEnabled, codemodeEnabled, durableChildrenEnabled, effectiveAgentConfig, effectivePiWebConfig, hasAgentDirEnvOverride, hasAgentSessionDirEnvOverride, loadPiWebConfig, maxUploadBytes, offlineModeEnabled, savePiWebConfig, spawnSessionsEnabled } from "./config.js";

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-config-test-"));
  configPath = join(tempDir, "config.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("Forgerie config persistence", () => {
  it("writes and reads the configured Forgerie config path", () => {
    const requestedConfig = {
      host: "0.0.0.0",
      port: 9000,
      plugins: { info: { enabled: false, settings: { compact: true } } },
      pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] },
      uploads: { defaultFolder: "manual\\incoming" },
    };
    const normalizedConfig = {
      ...requestedConfig,
      uploads: { defaultFolder: "manual/incoming" },
    };

    const saved = savePiWebConfig(requestedConfig, testOptions());

    expect(saved).toEqual({ path: configPath, exists: true, config: normalizedConfig });
    expect(loadPiWebConfig(testOptions())).toEqual(saved);
  });

  it("rejects invalid plugin config", async () => {
    await writeFile(configPath, `${JSON.stringify({ plugins: { info: { enabled: "no" } } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config plugin enabled values must be booleans");
  });

  it("rejects invalid path access config", async () => {
    await writeFile(configPath, `${JSON.stringify({ pathAccess: { allowedPaths: [""] } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config pathAccess.allowedPaths must be an array of non-empty strings");
  });

  it("persists and reads maxUploadBytes", () => {
    savePiWebConfig({ maxUploadBytes: 1234 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.maxUploadBytes).toBe(1234);
  });

  it("keeps a hand-edited extensionDialogsTimeoutMs across settings saves", async () => {
    await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: 60_000 }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000 }, testOptions());

    expect(loadPiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(60_000);
  });

  it("rejects an invalid extensionDialogsTimeoutMs", async () => {
    for (const value of [-1, 1.5, "5000", null]) {
      await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: value }, null, 2)}\n`, "utf8");

      expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config extensionDialogsTimeoutMs must be a non-negative integer");
    }
  });

  it("keeps a hand-edited sessionTitleModel across settings saves", async () => {
    await writeFile(configPath, `${JSON.stringify({ sessionTitleModel: "cliproxyapi/claude-haiku-5-5" }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000 }, testOptions());

    expect(effectivePiWebConfig(testOptions()).config.sessionTitleModel).toBe("cliproxyapi/claude-haiku-5-5");
  });

  it("rejects a sessionTitleModel that is not provider/model-id", async () => {
    for (const value of ["claude-haiku-5-5", "/claude-haiku-5-5", "cliproxyapi/", 5, null]) {
      await writeFile(configPath, `${JSON.stringify({ sessionTitleModel: value }, null, 2)}\n`, "utf8");

      expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config sessionTitleModel must be \"provider/model-id\"");
    }
  });

  it("persists and reads custom agent runtime settings", () => {
    savePiWebConfig({ agent: { command: "acme-agent", dir: "/opt/acme-agent/state" } }, testOptions());

    expect(loadPiWebConfig(testOptions()).config.agent).toEqual({ command: "acme-agent", dir: "/opt/acme-agent/state" });
  });

  it("defaults to the Pi agent directory only for canonical Pi companion names", () => {
    for (const command of ["pi", "pi.cmd"]) {
      expect(effectiveAgentConfig({ HOME: join(tempDir, ".home") }, { agent: { command } })).toMatchObject({
        command,
        dir: join(tempDir, ".home", ".pi", "agent"),
        sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"],
      });
    }
  });

  it("requires explicit state for alternate names and absolute Pi launchers", () => {
    const absolutePiCommand = join(tempDir, "bin", "pi");
    for (const command of ["acme-agent", absolutePiCommand]) {
      expect(() => effectiveAgentConfig({}, { agent: { command } })).toThrow(`Forgerie config agent.dir or PI_WEB_AGENT_DIR is required when agent.command is ${JSON.stringify(command)}`);
      expect(() => savePiWebConfig({ agent: { command } }, testOptions())).toThrow(`Forgerie config agent.dir or PI_WEB_AGENT_DIR is required when agent.command is ${JSON.stringify(command)}`);
    }
  });

  it("accepts safe bare executable names and host-absolute executable paths", () => {
    const absoluteCommand = join(tempDir, "bin", "acme-agent");
    const agentDir = join(tempDir, "state", "acme");

    expect(effectiveAgentConfig({}, { agent: { command: "acme-agent", dir: agentDir } })).toMatchObject({ command: "acme-agent", dir: agentDir });
    expect(effectiveAgentConfig({}, { agent: { command: absoluteCommand, dir: agentDir } })).toMatchObject({ command: absoluteCommand, dir: agentDir });
  });

  it.each(["./acme-agent", "bin/acme-agent", "../acme-agent", "node acme-agent.js", "acme-agent;other", "-acme-agent"])("rejects unsafe or workspace-relative agent command %j", (command) => {
    expect(() => savePiWebConfig({ agent: { command, dir: join(tempDir, "agent") } }, testOptions())).toThrow("safe bare executable name or host-absolute executable path");
  });

  it.skipIf(process.platform === "win32")("rejects foreign-platform absolute agent command and state paths", () => {
    expect(() => effectiveAgentConfig({}, { agent: { command: "C:\\tools\\acme-agent.exe", dir: join(tempDir, "agent") } })).toThrow("safe bare executable name or host-absolute executable path");
    expect(() => effectiveAgentConfig({}, { agent: { command: "acme-agent", dir: "C:\\profiles\\acme" } })).toThrow("agent.dir must be a host-absolute path");
  });

  it("rejects home expansion that would create a workspace-relative agent directory", () => {
    expect(() => effectiveAgentConfig({ HOME: "relative-home" })).toThrow("agent.dir must be a host-absolute path");
  });

  it("resolves explicit alternate agent command and state directory settings", () => {
    expect(effectiveAgentConfig({ HOME: join(tempDir, ".home") }, { agent: { command: "acme-agent", dir: "~/agent-profiles/acme" } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, ".home", "agent-profiles", "acme"),
      sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"],
    });
  });

  it("ignores empty agent environment overrides", () => {
    const env = {
      HOME: join(tempDir, ".home"),
      PI_WEB_AGENT_COMMAND: "",
      PI_WEB_AGENT_DIR: "",
      PI_WEB_AGENT_SESSION_DIR: "",
      PI_CODING_AGENT_DIR: "",
      PI_CODING_AGENT_SESSION_DIR: "",
    };

    expect(effectiveAgentConfig(env, { agent: { command: "acme-agent", dir: "~/agent-profiles/acme" } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, ".home", "agent-profiles", "acme"),
    });
    expect(hasAgentDirEnvOverride(env, "acme-agent")).toBe(false);
    expect(hasAgentSessionDirEnvOverride(env, "acme-agent")).toBe(false);
  });

  it("uses explicit Forgerie agent directory env precedence", () => {
    const env = {
      PI_WEB_AGENT_COMMAND: "acme-agent",
      PI_WEB_AGENT_DIR: join(tempDir, "web-env-agent"),
      PI_CODING_AGENT_DIR: join(tempDir, "pi-env-agent"),
    };
    expect(effectiveAgentConfig(env, { agent: { command: "pi", dir: join(tempDir, "config-agent") } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, "web-env-agent"),
    });
    expect(agentDirEnvSource(env)).toBe("pi-web");
  });

  it("keeps legacy Pi env directory overrides scoped to the canonical Pi command", () => {
    const legacyDir = join(tempDir, "pi-env-agent");
    const alternateDir = join(tempDir, "alternate-agent");
    const env = { PI_CODING_AGENT_DIR: legacyDir };
    expect(effectiveAgentConfig(env, { agent: { dir: join(tempDir, "config-agent") } })).toMatchObject({ dir: legacyDir });
    expect(effectiveAgentConfig(env, { agent: { command: "acme-agent", dir: alternateDir } })).toMatchObject({ command: "acme-agent", dir: alternateDir });
    expect(agentDirEnvSource(env)).toBe("pi-compatibility");
    expect(hasAgentDirEnvOverride(env, "pi")).toBe(true);
    expect(hasAgentDirEnvOverride(env, "acme-agent")).toBe(false);

    for (const command of ["acme-agent", join(tempDir, "bin", "pi")]) {
      expect(() => effectiveAgentConfig(env, { agent: { command } }))
        .toThrow(`Forgerie config agent.dir or PI_WEB_AGENT_DIR is required when agent.command is ${JSON.stringify(command)}`);
    }
  });

  it("uses only explicit session directory env keys", () => {
    expect(agentSessionDirEnvKeys()).toEqual(["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"]);
    expect(effectiveAgentConfig({ HOME: join(tempDir, ".home"), PI_WEB_AGENT_COMMAND: "acme-agent", PI_WEB_AGENT_DIR: join(tempDir, "agent") }).sessionDirEnvKeys).toEqual(["PI_WEB_AGENT_SESSION_DIR"]);
    expect(agentSessionDirEnvKeys(join(tempDir, "bin", "pi"))).toEqual(["PI_WEB_AGENT_SESSION_DIR"]);
  });

  it("rejects unknown nested agent keys instead of erasing them", async () => {
    const original = { agent: { command: "acme-agent", dir: join(tempDir, "agent"), futureSetting: true } };
    await writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow('Forgerie config agent contains unknown key "futureSetting"');
    expect(() => savePiWebConfig({ port: 9000 }, testOptions())).toThrow('Forgerie config agent contains unknown key "futureSetting"');
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(original);
  });

  it("exposes the default upload folder in the effective config", () => {
    expect(effectivePiWebConfig(testOptions()).config.uploads).toEqual({ defaultFolder: DEFAULT_UPLOADS_FOLDER });
  });

  it("resolves askUser in the effective config so the runtime has a single source of truth", async () => {
    expect(effectivePiWebConfig(testOptions()).config.askUser).toBe(true);

    await writeFile(configPath, `${JSON.stringify({ askUser: false }, null, 2)}\n`, "utf8");

    expect(effectivePiWebConfig(testOptions()).config.askUser).toBe(false);
    expect(effectivePiWebConfig({ ...testOptions(), env: { ...testOptions().env, PI_WEB_ASK_USER: "1" } }).config.askUser).toBe(true);
  });

  it("resolves codemode in the effective config, on unless the file or env turns it off", async () => {
    expect(effectivePiWebConfig(testOptions()).config.codemode).toBe(true);

    await writeFile(configPath, `${JSON.stringify({ codemode: false }, null, 2)}\n`, "utf8");

    expect(effectivePiWebConfig(testOptions()).config.codemode).toBe(false);
    expect(effectivePiWebConfig({ ...testOptions(), env: { ...testOptions().env, PI_WEB_CODEMODE: "1" } }).config.codemode).toBe(true);
  });

  it("round-trips the codemode key through save and load", () => {
    expect(savePiWebConfig({ codemode: false }, testOptions()).config).toEqual({ codemode: false });
    expect(loadPiWebConfig(testOptions()).config).toEqual({ codemode: false });
  });

  it("round-trips the askUser key through save and load", () => {
    expect(savePiWebConfig({ askUser: false }, testOptions()).config).toEqual({ askUser: false });
    expect(loadPiWebConfig(testOptions()).config).toEqual({ askUser: false });
  });

  it("rejects a non-boolean askUser key", async () => {
    await writeFile(configPath, `${JSON.stringify({ askUser: "yes" }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config askUser must be a boolean");
  });

  it("rejects upload defaults that are not workspace-relative", async () => {
    await writeFile(configPath, `${JSON.stringify({ uploads: { defaultFolder: "../outside" } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config uploads.defaultFolder must not contain path traversal");
  });
});

describe("maxUploadBytes", () => {
  it("defaults when nothing is configured", () => {
    expect(maxUploadBytes({}, {})).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it("prefers the env override over config", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "2048" }, { maxUploadBytes: 99 })).toBe(2048);
  });

  it("falls back to config when env is unset or invalid", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "not-a-number" }, { maxUploadBytes: 555 })).toBe(555);
  });
});

describe("extensionDialogsTimeoutMs", () => {
  it("defaults to five minutes when nothing is configured", () => {
    expect(effectivePiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS);
  });

  it("resolves a configured value, including zero for waiting forever", async () => {
    await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: 0 }, null, 2)}\n`, "utf8");

    expect(effectivePiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(0);
  });
});

describe("spawnSessionsEnabled", () => {
  it("is on by default when nothing is configured", () => {
    expect(spawnSessionsEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(spawnSessionsEnabled({}, { spawnSessions: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "0" }, { spawnSessions: true })).toBe(false);
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "1" }, { spawnSessions: false })).toBe(true);
  });
});

describe("askUserEnabled", () => {
  it("is on by default because the user is present for every ask", () => {
    expect(askUserEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(askUserEnabled({}, { askUser: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(askUserEnabled({ PI_WEB_ASK_USER: "0" }, { askUser: true })).toBe(false);
    expect(askUserEnabled({ PI_WEB_ASK_USER: "true" }, { askUser: false })).toBe(true);
  });

  it("treats an empty env value as unset", () => {
    expect(askUserEnabled({ PI_WEB_ASK_USER: "" }, { askUser: false })).toBe(false);
  });
});

describe("codemodeEnabled", () => {
  it("is on by default and honors an explicit config opt-out", () => {
    expect(codemodeEnabled({}, {})).toBe(true);
    expect(codemodeEnabled({}, { codemode: false })).toBe(false);
  });

  it("lets the env var override the config in both directions, and treats empty as unset", () => {
    expect(codemodeEnabled({ PI_WEB_CODEMODE: "0" }, { codemode: true })).toBe(false);
    expect(codemodeEnabled({ PI_WEB_CODEMODE: "true" }, { codemode: false })).toBe(true);
    expect(codemodeEnabled({ PI_WEB_CODEMODE: "" }, { codemode: false })).toBe(false);
  });

  it("rejects a config value that is not a boolean", async () => {
    await writeFile(configPath, `${JSON.stringify({ codemode: "yes" }, null, 2)}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config codemode must be a boolean");
  });
});

describe("childToolsDeny", () => {
  it("defaults to empty and persists named session tools", () => {
    expect(effectivePiWebConfig(testOptions()).config.childToolsDeny).toEqual([]);
    savePiWebConfig({ childToolsDeny: ["web_search", "fetch_content"] }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.childToolsDeny).toEqual(["web_search", "fetch_content"]);
    savePiWebConfig({ port: 9000 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.childToolsDeny).toEqual(["web_search", "fetch_content"]);
    savePiWebConfig({ childToolsDeny: [] }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.childToolsDeny).toEqual([]);
  });

  it.each([null, "web_search", [7], [""]])("rejects invalid deny lists %j", async (childToolsDeny) => {
    await writeFile(configPath, JSON.stringify({ childToolsDeny }));
    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config childToolsDeny must be an array of non-empty strings");
  });
});

describe("durableChildrenEnabled", () => {
  it("is off by default, and the env var overrides the config", () => {
    expect(durableChildrenEnabled({}, {})).toBe(false);
    expect(durableChildrenEnabled({}, { durableChildren: true })).toBe(true);
    expect(durableChildrenEnabled({ PI_WEB_DURABLE_CHILDREN: "0" }, { durableChildren: true })).toBe(false);
    expect(durableChildrenEnabled({ PI_WEB_DURABLE_CHILDREN: "1" }, {})).toBe(true);
  });

  it("survives a Settings save, which does not send it", async () => {
    await writeFile(configPath, `${JSON.stringify({ durableChildren: true }, null, 2)}\n`, "utf8");
    savePiWebConfig({ askUser: false }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.durableChildren).toBe(true);
  });

  it("rejects a config value that is not a boolean", async () => {
    await writeFile(configPath, `${JSON.stringify({ durableChildren: "yes" }, null, 2)}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("Forgerie config durableChildren must be a boolean");
  });
});

describe("offlineModeEnabled", () => {
  it("is off when no offline env var is set", () => {
    expect(offlineModeEnabled({})).toBe(false);
  });

  it("treats an empty value as unset", () => {
    expect(offlineModeEnabled({ PI_OFFLINE: "", PI_WEB_OFFLINE: "" })).toBe(false);
  });

  it("is on when either offline key has a value", () => {
    expect(offlineModeEnabled({ PI_OFFLINE: "1" })).toBe(true);
    expect(offlineModeEnabled({ PI_WEB_OFFLINE: "anything" })).toBe(true);
  });

  it("ignores the narrower skip-version-check keys", () => {
    expect(offlineModeEnabled({ PI_SKIP_VERSION_CHECK: "1", PI_WEB_SKIP_VERSION_CHECK: "1" })).toBe(false);
  });
});

function testOptions(): { env: NodeJS.ProcessEnv } {
  return { env: { PI_WEB_CONFIG: configPath } };
}
