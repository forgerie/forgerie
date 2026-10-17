#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectivePiWebConfig } from "./config.js";
import { deployCommand } from "./deployment.js";
import { packageVersion, printPiWebVersionReport } from "./piWebVersionReport.js";
import { FORGERIE_SERVICE_UNITS } from "./shared/localServices.js";

export type ServiceAction = "start" | "stop" | "restart" | "status";

/** Existing systemd units only. This CLI never writes or installs unit files. */
export function serviceActionArguments(action: ServiceAction): string[] {
  const units = action === "start" ? [...FORGERIE_SERVICE_UNITS].reverse() : [...FORGERIE_SERVICE_UNITS];
  return ["--user", action, ...units];
}

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) console.error(result.error.message);
  return result.status === 0;
}

function requireSystemd(): void {
  if (process.platform !== "linux") throw new Error("Local service commands require Linux and existing systemd user units. Run npm run dev on other hosts.");
}

async function doctor(): Promise<void> {
  const { path, config } = effectivePiWebConfig();
  console.log(`Node: ${process.version}; verification uses Node 24`);
  console.log(`Config: ${path}`);
  console.log(`Agent: ${config.agent.command}; profile: ${config.agent.dir}`);
  const runtimeOk = await printPiWebVersionReport();
  const servicesOk = process.platform !== "linux" || run("systemctl", serviceActionArguments("status"));
  const [majorVersion = 0, minorVersion = 0] = process.versions.node.split(".").map(Number);
  if (!runtimeOk || !servicesOk || majorVersion < 22 || (majorVersion === 22 && minorVersion < 19)) process.exitCode = 1;
}

function help(): void {
  console.log(`Forgerie — local checkout

Usage:
  forgerie start|stop|restart|status|logs
  forgerie deploy record BUILT_DIST EXPECTED_SHA
  forgerie deploy BUILT_DIST DEPLOYED_DIST EXPECTED_SHA [--when-idle WORKSPACE [--limit-minutes N]] [--readiness-seconds N]
  forgerie doctor
  forgerie version
  forgerie --version

Services must already exist in the host configuration.
For development: npm run dev
For deployment: follow docs/deployment.md
`);
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "deploy") { await deployCommand(args); return; }
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0] ?? ""}`);
  if (command === "start" || command === "stop" || command === "restart" || command === "status") {
    requireSystemd();
    if (!run("systemctl", serviceActionArguments(command))) process.exitCode = 1;
  } else if (command === "logs") {
    requireSystemd();
    if (!run("journalctl", ["--user", ...FORGERIE_SERVICE_UNITS.flatMap((unit) => ["-u", unit]), "-f"])) process.exitCode = 1;
  } else if (command === "doctor") await doctor();
  else if (command === "version") { if (!await printPiWebVersionReport()) process.exitCode = 1; }
  else if (command === "--version" || command === "-v") console.log(packageVersion());
  else if (command === "help" || command === "--help" || command === "-h") help();
  else throw new Error(`Unknown command: ${command}. Use forgerie --help.`);
}

export function isCliEntrypoint(entrypoint: string | undefined = process.argv[1], modulePath: string = fileURLToPath(import.meta.url)): boolean {
  if (entrypoint === undefined) return false;
  if (entrypoint === modulePath) return true;
  try { return realpathSync(entrypoint) === realpathSync(modulePath); } catch { return false; }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
