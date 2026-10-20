#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Serial native /open probe: direct daemon socket versus the web edge, with web
// spans from a fixture started with --measure. Counts and timings only; no bodies.
// Usage: node scripts/stack-latency-proxy-probe.mjs FIXTURE.json NEW-output.json [samples=200] [sessionIndexes=1]
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { cpus, loadavg } from "node:os";
import { execFileSync } from "node:child_process";
import { summarize } from "../ui/scripts/stack-latency-contract.mjs";

const [fixturePath, output, rawSamples = "200", rawIndexes = "1"] = process.argv.slice(2);
assert.ok(fixturePath && output && !existsSync(output), "fixture.json and a NEW output path are required");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.ok(fixture.measure === true, "Start the native fixture with --measure");
const origin = new URL(fixture.origin);
assert.equal(origin.hostname, "127.0.0.1");
const samples = Number(rawSamples);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 5000);
const indexes = rawIndexes.split(",").map(Number);

/** Time to headers and to the complete raw body on this process's monotonic clock. */
function timed(options) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = request({ ...options, method: "GET", timeout: 30000 }, response => {
      const headersMs = performance.now() - start;
      let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; });
      response.on("end", () => resolve({ status: response.statusCode, headersMs, totalMs: performance.now() - start, bytes,
        encoding: response.headers["content-encoding"] ?? "identity", serverTiming: response.headers["server-timing"] ?? null }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.on("error", reject);
    req.end();
  });
}

const result = { version: 1, source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), startedAt: new Date().toISOString(),
  loadStart: loadavg(), cores: cpus().length, samplesPerSeries: samples, series: {} };
for (const index of indexes) {
  const session = fixture.sessions[index];
  assert.ok(session, `No fixture session ${index}`);
  const path = `/sessions/${session.id}/open?${new URLSearchParams({ cwd: session.cwd, limit: "50" })}`;
  const rows = { direct: [], edgeGzip: [], edgeIdentity: [] };
  const failures = { direct: 0, edgeGzip: 0, edgeIdentity: 0 };
  for (let sample = 0; sample < samples; sample++) {
    // Rotate the order so no series always runs first after the previous one.
    const order = [["direct"], ["edgeGzip"], ["edgeIdentity"]];
    for (let turn = 0; turn < 3; turn++) {
      const [kind] = order[(sample + turn) % 3];
      const traceId = randomBytes(16).toString("hex");
      const row = kind === "direct"
        ? await timed({ socketPath: fixture.socket, path })
        : await timed({ host: "127.0.0.1", port: Number(origin.port), path: `/api${path}`,
          headers: { "x-forgerie-trace": traceId, "accept-encoding": kind === "edgeGzip" ? "gzip" : "identity" } });
      if (row.status !== 200) { failures[kind]++; continue; }
      if (kind !== "direct") {
        const spans = (await (await fetch(`${fixture.origin}/__fixtures/spans?traceId=${traceId}`, { headers: { "x-fixture-token": fixture.token } })).json()).spans;
        for (const span of spans) row[span.phase] = span.durationMs;
      }
      rows[kind].push(row);
    }
  }
  const pick = (list, field) => list.map(row => row[field]).filter(Number.isFinite);
  result.series[`session-${index}-turns-${session.turns}`] = Object.fromEntries(Object.entries(rows).map(([kind, list]) => [kind, {
    n: list.length, failures: failures[kind], bytes: list[0]?.bytes ?? null, encoding: list[0]?.encoding ?? null,
    headersMs: summarize(pick(list, "headersMs")), totalMs: summarize(pick(list, "totalMs")),
    ...(kind === "direct" ? {} : { webTransportMs: summarize(pick(list, "transport")), webDecodeMs: summarize(pick(list, "decode")), webSerializeIntervalMs: summarize(pick(list, "serialize")) }),
  }]));
}
result.loadEnd = loadavg(); result.finishedAt = new Date().toISOString();
result.notes = ["direct = probe→daemon unix socket", "web spans are web-clock intervals inside the edge request", "serialize interval spans Fastify serialization and edge compression", "warm active owners; not daemon/OS cold"];
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.series, null, 2));
