#!/usr/bin/env tsx
/**
 * Recover `agentSpawned` marks by hand.
 *
 * The daemon runs this same sweep in the background at startup, so this script
 * exists for the cases where that is not enough: a one-off repair, a machine
 * whose daemon is not running, or checking what a sweep would do before
 * letting one happen.
 *
 * The rule and its safety gates live in src/server/sessions, not here. A
 * second implementation would be a second set of bugs.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { repairAgentSpawnedMarks } from "../src/server/sessions/agentSpawnedRepair.js";

const sessionsRoot = process.argv.find((argument) => argument.startsWith("--sessions="))?.slice("--sessions=".length)
  ?? join(homedir(), ".pi", "agent", "sessions");

process.stdout.write(`sweeping ${sessionsRoot}…\n`);
const report = await repairAgentSpawnedMarks(sessionsRoot);

process.stdout.write([
  `transcripts read      : ${String(report.scanned)}`,
  `sessions named spawned: ${String(report.named)}`,
  `newly marked          : ${String(report.marked)}`,
  `already marked        : ${String(report.already)}`,
  `skipped, still live   : ${String(report.busy)}`,
  `named but gone        : ${String(report.absent)}`,
  "",
].join("\n"));

if (report.busy > 0) {
  process.stdout.write("\nSessions still being written were left alone. Re-run once they are idle.\n");
}
