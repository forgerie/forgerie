import { describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "forgerie/plugin-api";
import { additionalCommands, fallbackDockerStatus, formatVersion, installationLabel, messageCount, recommendedCommand, shouldShowUpdatesPanel } from "./updatesLogic";

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.202605.8",
    installedVersion: "1.202605.8",
    stale: false,
    available: true,
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "forgerie",
    generatedAt: "2026-06-14T00:00:00.000Z",
    components: {
      web: component({ component: "web", label: "Web/UI" }),
      sessiond: component({ component: "sessiond", label: "Session daemon" }),
    },
    release: { packageName: "forgerie", updateAvailable: false },
    commands: {},
    messages: [],
    ...overrides,
  };
}

function stateWith(value: PiWebStatusResponse | undefined): PluginRuntimeState {
  return value === undefined ? {} : { piWebStatus: value };
}

describe("recommendedCommand", () => {
  it("recommends update & restart when an update is available", () => {
    const result = recommendedCommand(status({
      release: { packageName: "forgerie", updateAvailable: true },
      commands: { update: "forgerie update && forgerie restart", restart: "forgerie restart" },
    }));
    expect(result).toEqual({ label: "Update & restart everything", command: "forgerie update && forgerie restart" });
  });

  it("falls through to restart when an update is available but the update command is empty", () => {
    const result = recommendedCommand(status({
      release: { packageName: "forgerie", updateAvailable: true },
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { update: "", restart: "forgerie restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "forgerie restart" });
  });

  it("recommends restart when the web component is stale", () => {
    const result = recommendedCommand(status({
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { restart: "forgerie restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "forgerie restart" });
  });

  it("recommends restart when the session daemon is unavailable", () => {
    const result = recommendedCommand(status({
      components: {
        web: component(),
        sessiond: component({ component: "sessiond", label: "Session daemon", available: false }),
      },
      commands: { restart: "forgerie restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "forgerie restart" });
  });

  it("recommends restart when the session daemon is stale", () => {
    const result = recommendedCommand(status({
      components: {
        web: component(),
        sessiond: component({ component: "sessiond", label: "Session daemon", stale: true }),
      },
      commands: { restart: "forgerie restart" },
    }));
    expect(result).toEqual({ label: "Restart everything", command: "forgerie restart" });
  });

  it("returns nothing when everything is current and available", () => {
    expect(recommendedCommand(status({ commands: { restart: "forgerie restart" } }))).toBeUndefined();
  });

  it("preserves explicit Docker command text", () => {
    expect(recommendedCommand(status({
      release: { packageName: "forgerie", updateAvailable: true },
      commands: { update: "forgerie-docker update", restart: "forgerie-docker restart" },
    }))).toEqual({ label: "Update & restart everything", command: "forgerie-docker update" });
    expect(recommendedCommand(status({
      components: {
        web: component({ stale: true, installation: { kind: "docker", dockerMode: "dev" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "docker", dockerMode: "dev" } }),
      },
      commands: { restart: "forgerie-docker --dev restart" },
    }))).toEqual({ label: "Restart everything", command: "forgerie-docker --dev restart" });
  });

  it("does not fabricate a restart command when one is not configured", () => {
    const result = recommendedCommand(status({
      components: {
        web: component({ stale: true }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { restart: "" },
    }));
    expect(result).toBeUndefined();
  });
});

describe("additionalCommands", () => {
  it("drops empty commands and the recommended command, preserving order", () => {
    const value = status({
      commands: {
        update: "forgerie update",
        restart: "forgerie restart",
        restartWeb: "",
        restartSessiond: "forgerie restart sessiond",
        status: "forgerie status",
      },
    });
    const result = additionalCommands(value, { label: "Restart everything", command: "forgerie restart" });
    expect(result).toEqual([
      { label: "Update", command: "forgerie update" },
      { label: "Restart session daemon", command: "forgerie restart sessiond" },
      { label: "Status", command: "forgerie status" },
    ]);
  });

  it("keeps all commands when there is no recommended command", () => {
    const value = status({ commands: { update: "forgerie update", status: "forgerie status" } });
    expect(additionalCommands(value, undefined)).toEqual([
      { label: "Update", command: "forgerie update" },
      { label: "Status", command: "forgerie status" },
    ]);
  });

  it("presents Docker runtime and development commands exactly as reported", () => {
    expect(additionalCommands(status({
      commands: {
        update: "forgerie-docker update",
        restart: "forgerie-docker restart",
        restartWeb: "forgerie-docker restart-web",
        restartSessiond: "forgerie-docker restart-sessiond",
        status: "forgerie-docker status",
      },
    }), undefined)).toEqual([
      { label: "Update", command: "forgerie-docker update" },
      { label: "Restart all", command: "forgerie-docker restart" },
      { label: "Restart Web/UI", command: "forgerie-docker restart-web" },
      { label: "Restart session daemon", command: "forgerie-docker restart-sessiond" },
      { label: "Status", command: "forgerie-docker status" },
    ]);

    expect(additionalCommands(status({
      commands: {
        update: "forgerie-docker --dev update",
        restart: "forgerie-docker --dev restart",
        restartWeb: "forgerie-docker --dev restart-web",
        restartSessiond: "forgerie-docker --dev restart-sessiond",
        status: "forgerie-docker --dev status",
      },
    }), { label: "Update & restart everything", command: "forgerie-docker --dev update" })).toEqual([
      { label: "Restart all", command: "forgerie-docker --dev restart" },
      { label: "Restart Web/UI", command: "forgerie-docker --dev restart-web" },
      { label: "Restart session daemon", command: "forgerie-docker --dev restart-sessiond" },
      { label: "Status", command: "forgerie-docker --dev status" },
    ]);
  });
});

describe("shouldShowUpdatesPanel", () => {
  const messages: PiWebStatusMessage[] = [{ id: "x", severity: "warning", title: "t", body: "b" }];

  it("shows the panel whenever there are messages, even on a managed install", () => {
    const value = status({
      messages,
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(true);
  });

  it("shows the panel when a federated Docker runtime hint is available before status is parsed", () => {
    expect(shouldShowUpdatesPanel(undefined, { dockerMode: "dev" })).toBe(true);
    expect(shouldShowUpdatesPanel(undefined, { dockerMode: "runtime" })).toBe(true);
  });

  it("hides the panel when status is unavailable", () => {
    expect(shouldShowUpdatesPanel(stateWith(undefined))).toBe(false);
    expect(shouldShowUpdatesPanel(undefined)).toBe(false);
  });

  it("shows the panel for local, Docker, or unknown installs", () => {
    const local = status({
      components: {
        web: component({ installation: { kind: "local" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(local))).toBe(true);

    const docker = status({
      components: {
        web: component({ installation: { kind: "docker", dockerMode: "runtime" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "docker", dockerMode: "runtime" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(docker))).toBe(true);

    const unknown = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(unknown))).toBe(true);
  });

  it("hides the panel for fully managed installs with no messages", () => {
    const value = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "npm-global" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(false);
  });
});

describe("fallbackDockerStatus", () => {
  it("creates Docker development commands from a federated runtime hint", () => {
    const fallback = fallbackDockerStatus({ dockerMode: "dev" }, "generated");
    expect(fallback?.generatedAt).toBe("generated");
    expect(fallback?.components.web.installation).toEqual({ kind: "docker", dockerMode: "dev" });
    expect(fallback?.commands).toEqual({
      update: "forgerie-docker --dev update",
      restart: "forgerie-docker --dev restart",
      restartWeb: "forgerie-docker --dev restart-web",
      restartSessiond: "forgerie-docker --dev restart-sessiond",
      status: "forgerie-docker --dev status",
    });
    expect(fallback?.messages[0]?.id).toBe("docker-status-compatibility");
  });

  it("creates Docker runtime commands without the development prefix", () => {
    const fallback = fallbackDockerStatus({ dockerMode: "runtime" });
    expect(fallback?.components.sessiond.installation).toEqual({ kind: "docker", dockerMode: "runtime" });
    expect(fallback?.commands).toEqual({
      update: "forgerie-docker update",
      restart: "forgerie-docker restart",
      restartWeb: "forgerie-docker restart-web",
      restartSessiond: "forgerie-docker restart-sessiond",
      status: "forgerie-docker status",
    });
  });

  it("does not create a fallback without a Docker runtime hint", () => {
    expect(fallbackDockerStatus({})).toBeUndefined();
  });
});

describe("messageCount", () => {
  it("counts messages and tolerates missing status", () => {
    expect(messageCount(undefined)).toBe(0);
    expect(messageCount(stateWith(status()))).toBe(0);
    expect(messageCount(stateWith(status({ messages: [{ id: "a", severity: "info", title: "t", body: "b" }] })))).toBe(1);
  });
});

describe("formatVersion", () => {
  it("renders unknown for missing or empty versions", () => {
    expect(formatVersion(undefined)).toBe("unknown");
    expect(formatVersion("")).toBe("unknown");
    expect(formatVersion("1.202605.8")).toBe("1.202605.8");
  });
});

describe("installationLabel", () => {
  it("labels each installation kind", () => {
    expect(installationLabel(undefined)).toBe("installation unknown");
    expect(installationLabel({ kind: "unknown" })).toBe("installation unknown");
    expect(installationLabel({ kind: "npm-global" })).toBe("global npm package");
    expect(installationLabel({ kind: "local" })).toBe("local checkout");
    expect(installationLabel({ kind: "docker", dockerMode: "runtime" })).toBe("Docker runtime");
    expect(installationLabel({ kind: "docker", dockerMode: "dev" })).toBe("Docker development runtime");
  });

  it("includes source and scope for pi-package installs", () => {
    expect(installationLabel({ kind: "pi-package", source: "npm:forgerie", scope: "user" }))
      .toBe("npm:forgerie · user");
  });

  it("defaults the source and omits scope when absent", () => {
    expect(installationLabel({ kind: "pi-package" })).toBe("Pi package");
  });
});
