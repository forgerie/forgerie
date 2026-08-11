#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium --command node
// Probe Forgerie's observable chat-opening timings with real row activation.
//
// Examples:
//   scripts/probe-chat-open.mjs --url http://127.0.0.1:8504/ --shots /tmp/forgerie-chat-open
//   scripts/probe-chat-open.mjs --same-session-id <id> --same-cwd /repo --cross-session-id <id> --cross-cwd /other
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "./lib/cdp.mjs";

const POSTURES = [
  { name: "unfolded-portrait", width: 739, height: 979 },
  { name: "unfolded-landscape", width: 979, height: 739 },
  { name: "folded-portrait", width: 499, height: 789 },
  { name: "folded-landscape", width: 789, height: 499 },
];

const TIMING_NAMESPACE = "forgerie.chat-open";
const LONG_TASK_WARNING_MS = 50;
const SHELL_BUDGET_MS = 100;

function usage() {
  return `Usage: scripts/probe-chat-open.mjs [options]\n\nDrives real inbox row activation in Chromium, reads Forgerie's User Timing measures,\nobserves browser long tasks, checks for old-transcript flash, and captures Fold 8\nposture screenshots. Shell paint over 100 ms and old transcript flash fail. Long\ntasks over 50 ms are diagnostic warnings only.\n\nOptions:\n  --url URL                    Forgerie URL (default: http://127.0.0.1:8504/)\n  --shots DIR                  Screenshot output dir (default: /tmp/forgerie-chat-open-probe)\n  --chrome-bin PATH            Chromium binary override\n  --shell-budget-ms N          Failing shell budget (default: 100)\n  --long-task-warning-ms N     Diagnostic long-task threshold (default: 50)\n  --settle-ms N                Page-load settle time (default: 2500)\n  --timeout-ms N               Milestone wait timeout (default: 20000)\n  --hydration-delay-ms N       Fetch delay used for visible opening/cached states (default: 250)\n  --same-session-id ID         Same-workspace target session id\n  --same-cwd CWD               Same-workspace target cwd\n  --previous-session-id ID     Source session id used before same/cross activations\n  --previous-cwd CWD           Source session cwd\n  --cross-session-id ID        Cross-workspace target session id\n  --cross-cwd CWD              Cross-workspace target cwd\n  --large-session-id ID        Large-transcript target session id\n  --large-cwd CWD              Large-transcript target cwd\n  --skip-shots                 Do not write screenshots\n  --help                       Show this help\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or pass --chrome-bin.");

  const representatives = await representativeSessions(args);
  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-chat-open-probe-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"), { windowSize: "979,739" });
  const failures = [];
  const warnings = [];

  try {
    await waitForDebugger(debugPort);
    for (const posture of POSTURES) {
      process.stdout.write(`\n== ${posture.name} (${posture.width}x${posture.height})\n`);
      const result = await probePosture({ args, debugPort, posture, representatives });
      failures.push(...result.failures.map((failure) => `${posture.name}: ${failure}`));
      warnings.push(...result.warnings.map((warning) => `${posture.name}: ${warning}`));
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (warnings.length > 0) {
    process.stdout.write("\nDiagnostic warnings:\n");
    for (const warning of warnings) process.stdout.write(`  WARN ${warning}\n`);
  }
  if (failures.length > 0) {
    process.stderr.write("\nFailing chat-open probe checks:\n");
    for (const failure of failures) process.stderr.write(`  FAIL ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write("\nChat-open probe passed shell, cold→warm, and old-transcript-flash gates.\n");
}

async function probePosture({ args, debugPort, posture, representatives }) {
  const cdp = await openPage(debugPort);
  const failures = [];
  const warnings = [];
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: posture.width,
      height: posture.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const loaded = cdp.waitForEvent("Page.loadEventFired", args.timeoutMs).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await loaded;
    await sleep(args.settleMs);
    await installProbeHooks(cdp);
    await waitForRow(cdp, representatives.previous, args.timeoutMs);
    const largeTarget = await visibleLargeRepresentative(cdp, representatives.largeCandidates);
    if (!sameSessionRef(largeTarget, representatives.large)) {
      process.stdout.write(`  large fallback       ${describeRef(largeTarget)} (preferred catalog entry is not an inbox row)\n`);
    }

    await selectAndWaitReady(cdp, representatives.previous, args, "baseline-previous");
    await removeHistoryCache(cdp, representatives.same);

    const sameCold = await activateMeasuredScenario(cdp, {
      args,
      posture,
      source: representatives.previous,
      target: representatives.same,
      label: "same-workspace-cold",
      delayHydration: true,
      captureOpening: false,
      captureCached: false,
    });
    reportScenario(sameCold);
    failures.push(...gateScenario(sameCold, args));
    warnings.push(...longTaskWarnings(sameCold, args));
    await waitForHistoryCache(cdp, representatives.same, args.timeoutMs);

    const sameWarm = await activateMeasuredScenario(cdp, {
      args,
      posture,
      source: representatives.previous,
      target: representatives.same,
      label: "same-workspace-warm",
      delayHydration: true,
      captureOpening: true,
      captureCached: true,
    });
    reportScenario(sameWarm);
    reportColdWarmComparison(sameCold, sameWarm);
    failures.push(...gateScenario(sameWarm, args));
    failures.push(...coldWarmComparisonFailures(sameCold.measures, sameWarm.measures));
    warnings.push(...longTaskWarnings(sameWarm, args));

    const cross = await activateMeasuredScenario(cdp, {
      args,
      posture,
      source: representatives.previous,
      target: representatives.cross,
      label: "cross-workspace",
      delayHydration: true,
      captureOpening: true,
      captureCached: false,
    });
    reportScenario(cross);
    failures.push(...gateScenario(cross, args));
    warnings.push(...longTaskWarnings(cross, args));

    const largeSource = sourceForTarget(largeTarget, [representatives.previous, representatives.same, representatives.cross]);
    const large = await activateMeasuredScenario(cdp, {
      args,
      posture,
      source: largeSource,
      target: largeTarget,
      label: "large-transcript",
      delayHydration: false,
      captureOpening: false,
      captureCached: false,
    });
    reportScenario(large);
    failures.push(...gateScenario(large, args));
    warnings.push(...longTaskWarnings(large, args));

    await captureFailedRetryState(cdp, args, posture, representatives.same);
  } finally {
    cdp.close();
  }
  return { failures, warnings };
}

async function activateMeasuredScenario(cdp, options) {
  const { args, target, source, label, posture } = options;
  await setFetchBehavior(cdp, { delayMs: 0 });
  await selectAndWaitReady(cdp, source, args, `${label}-source`);
  await clearTimingAndLongTasks(cdp);
  await setFetchBehavior(cdp, { delayMs: options.delayHydration ? args.hydrationDelayMs : 0, target });
  await startOldFlashWatch(cdp, target);

  let stoppedWatch = false;
  try {
    const attemptId = await clickSessionRowAndWaitForAttempt(cdp, target, args.timeoutMs);
    await waitForMilestone(cdp, attemptId, "shell-painted", args.timeoutMs, target);
    if (options.captureOpening) await screenshot(cdp, args, `${posture.name}-${label}-opening`);
    if (options.captureCached) {
      await waitForMilestone(cdp, attemptId, "cached-transcript-painted", args.timeoutMs, target);
      await screenshot(cdp, args, `${posture.name}-${label}-cached-updating`);
    }
    await waitForTerminalMilestone(cdp, attemptId, args.timeoutMs, target);
    stoppedWatch = true;
    const oldFlash = await stopOldFlashWatch(cdp);
    await screenshot(cdp, args, `${posture.name}-${label}-ready`);
    await setFetchBehavior(cdp, { delayMs: 0 });
    const measures = await timingMeasures(cdp, attemptId);
    const longTasks = await longTasksForAttempt(cdp, measures);
    return { label, target, attemptId, measures, longTasks, oldFlash };
  } finally {
    await setFetchBehavior(cdp, { delayMs: 0 });
    if (!stoppedWatch) await stopOldFlashWatch(cdp);
  }
}

async function captureFailedRetryState(cdp, args, posture, target) {
  await setFetchBehavior(cdp, { delayMs: 0 });
  await selectAndWaitReady(cdp, target, args, "failed-retry-source");
  await forceSelectedFailure(cdp, target);
  await waitForRetryButton(cdp, args.timeoutMs);
  await screenshot(cdp, args, `${posture.name}-failed-retry`);
  const beforeAttemptId = await latestIntentAttemptId(cdp, target);
  await clickRetry(cdp);
  const attemptId = await waitForLatestIntentAttempt(cdp, target, beforeAttemptId ?? 0, args.timeoutMs);
  await waitForTerminalMilestone(cdp, attemptId, args.timeoutMs, target);
  await screenshot(cdp, args, `${posture.name}-failed-retry-ready`);
}

function reportScenario(result) {
  const shell = durationFor(result.measures, "shell-painted");
  const cached = durationFor(result.measures, "cached-transcript-painted");
  const fresh = durationFor(result.measures, "fresh-transcript-painted");
  const live = durationFor(result.measures, "live-ready");
  const readOnly = durationFor(result.measures, "read-only-ready");
  const failed = durationFor(result.measures, "failed");
  const terminal = live ?? readOnly ?? failed;
  process.stdout.write(
    `  ${result.label.padEnd(21)} attempt=${String(result.attemptId).padStart(3)} shell=${formatMs(shell)} cached=${formatMs(cached)} fresh=${formatMs(fresh)} terminal=${formatMs(terminal)} oldFlash=${String(result.oldFlash)} longTasks=${String(result.longTasks.length)}\n`,
  );
}

function reportColdWarmComparison(cold, warm) {
  const coldFresh = durationFor(cold.measures, "fresh-transcript-painted");
  const warmCached = durationFor(warm.measures, "cached-transcript-painted");
  process.stdout.write(`  ${"cold→warm readable".padEnd(21)} coldFresh=${formatMs(coldFresh)} warmCached=${formatMs(warmCached)} improvement=${formatMs(coldFresh !== undefined && warmCached !== undefined ? coldFresh - warmCached : undefined)}\n`);
}

function gateScenario(result, args) {
  const failures = [];
  const shell = durationFor(result.measures, "shell-painted");
  if (shell === undefined) failures.push(`${result.label} did not record shell-painted for attempt ${String(result.attemptId)} ${describeRef(result.target)}`);
  else if (shell > args.shellBudgetMs) failures.push(`${result.label} shell-painted ${formatMs(shell)} exceeds ${String(args.shellBudgetMs)} ms for attempt ${String(result.attemptId)} ${describeRef(result.target)}`);
  if (result.oldFlash) failures.push(`${result.label} showed previous chat message object identities after activating attempt ${String(result.attemptId)} ${describeRef(result.target)}`);
  return failures;
}

export function coldWarmComparisonFailures(coldMeasures, warmMeasures) {
  const failures = [];
  const coldFresh = durationFor(coldMeasures, "fresh-transcript-painted");
  const warmCached = durationFor(warmMeasures, "cached-transcript-painted");
  if (coldFresh === undefined) failures.push("same-workspace-cold did not record fresh-transcript-painted for first readable latency");
  if (warmCached === undefined) failures.push("same-workspace-warm did not record cached-transcript-painted after cold populated cache");
  if (coldFresh !== undefined && warmCached !== undefined && warmCached >= coldFresh) {
    failures.push(`same-workspace warm first-readable latency ${formatMs(warmCached)} did not improve over cold fresh-readable latency ${formatMs(coldFresh)}`);
  }
  return failures;
}

function longTaskWarnings(result, args) {
  return result.longTasks
    .filter((entry) => entry.duration > args.longTaskWarningMs)
    .map((entry) => `${result.label} long task ${formatMs(entry.duration)} between shell and fresh transcript at ${formatMs(entry.startTime)} for attempt ${String(result.attemptId)} ${describeRef(result.target)}`);
}

async function installProbeHooks(cdp) {
  await evaluate(cdp, `
    (() => {
      const walk = (root, test) => {
        for (const element of root.querySelectorAll("*")) {
          if (test(element)) return element;
          if (element.shadowRoot) {
            const found = walk(element.shadowRoot, test);
            if (found) return found;
          }
        }
        return undefined;
      };
      const originalFetch = window.__chatOpenProbe?.originalFetch ?? window.fetch.bind(window);
      window.__chatOpenProbe = {
        originalFetch,
        fetchDelayMs: 0,
        fetchTarget: undefined,
        longTasks: [],
        oldFlash: false,
        oldFlashWatch: undefined,
        walk,
        chatView: () => walk(document, (element) => element.tagName === "CHAT-VIEW"),
        row: (sessionId) => walk(document, (element) => element.getAttribute?.("data-session") === sessionId),
      };
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
        const probe = window.__chatOpenProbe;
        const target = probe.fetchTarget;
        const appliesToTarget = target === undefined || (url.pathname.includes("/sessions/" + encodeURIComponent(target.sessionId) + "/") && url.searchParams.get("cwd") === target.cwd);
        if (appliesToTarget && probe.fetchDelayMs > 0 && /\\/(messages|status|stream-snapshot|notifications)$/.test(url.pathname)) {
          await new Promise((resolve) => setTimeout(resolve, probe.fetchDelayMs));
        }
        return originalFetch(input, init);
      };
      if (typeof PerformanceObserver !== "undefined") {
        try {
          const probePushLongTasks = (entries) => {
            for (const entry of entries) window.__chatOpenProbe.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          };
          const observer = new PerformanceObserver((list) => {
            probePushLongTasks(list.getEntries());
          });
          observer.observe({ type: "longtask", buffered: true });
          window.__chatOpenProbe.longTaskObserver = observer;
        } catch {
          window.__chatOpenProbe.longTaskObserver = undefined;
        }
      }
      return true;
    })()
  `);
}

async function setFetchBehavior(cdp, { delayMs, target }) {
  await evaluate(cdp, `
    (() => {
      window.__chatOpenProbe.fetchDelayMs = ${JSON.stringify(delayMs)};
      window.__chatOpenProbe.fetchTarget = ${target === undefined ? "undefined" : JSON.stringify(target)};
      return true;
    })()
  `);
}

async function clearTimingAndLongTasks(cdp) {
  await evaluate(cdp, `
    (() => {
      for (const entry of performance.getEntriesByType("mark")) if (entry.name.startsWith(${JSON.stringify(TIMING_NAMESPACE)})) performance.clearMarks(entry.name);
      for (const entry of performance.getEntriesByType("measure")) if (entry.name.startsWith(${JSON.stringify(TIMING_NAMESPACE)})) performance.clearMeasures(entry.name);
      window.__chatOpenProbe.longTasks = [];
      return true;
    })()
  `);
}

async function startOldFlashWatch(cdp, target) {
  await evaluate(cdp, `
    (() => {
      const target = ${JSON.stringify(target)};
      const probe = window.__chatOpenProbe;
      if (probe.oldFlashWatch?.frame !== undefined) cancelAnimationFrame(probe.oldFlashWatch.frame);
      const previousChat = probe.chatView();
      const previousMessages = previousChat?.messages;
      const previousMessageSet = new Set(Array.isArray(previousMessages) ? previousMessages : []);
      const watch = { active: true, frame: undefined, previousMessages, previousMessageSet };
      probe.oldFlash = false;
      probe.oldFlashWatch = watch;
      const sample = () => {
        if (!watch.active) return;
        const chat = probe.chatView();
        const messages = chat?.messages;
        if (chat?.sessionId === target.sessionId && Array.isArray(messages) && previousMessageSet.size > 0) {
          if (messages === previousMessages || messages.some((message) => previousMessageSet.has(message))) probe.oldFlash = true;
        }
        watch.frame = requestAnimationFrame(sample);
      };
      watch.frame = requestAnimationFrame(sample);
      return true;
    })()
  `);
}

async function stopOldFlashWatch(cdp) {
  return await evaluate(cdp, `
    (() => {
      const probe = window.__chatOpenProbe;
      const watch = probe.oldFlashWatch;
      if (watch !== undefined) {
        watch.active = false;
        if (watch.frame !== undefined) cancelAnimationFrame(watch.frame);
        probe.oldFlashWatch = undefined;
      }
      return probe.oldFlash === true;
    })()
  `);
}

async function clickSessionRowAndWaitForAttempt(cdp, ref, timeoutMs) {
  const beforeAttemptId = await latestIntentAttemptId(cdp, ref);
  await clickSessionRow(cdp, ref);
  return await waitForLatestIntentAttempt(cdp, ref, beforeAttemptId ?? 0, timeoutMs);
}

async function clickSessionRow(cdp, ref) {
  let clicked = await clickVisibleSessionRow(cdp, ref);
  if (!clicked) {
    await revealCollapsedSessionGroups(cdp);
    clicked = await clickVisibleSessionRow(cdp, ref);
  }
  if (!clicked) fail(`Could not find inbox row for ${describeRef(ref)} after expanding every non-archived inbox group. Pass explicit representative ids or open the target inbox.`);
}

async function clickVisibleSessionRow(cdp, ref) {
  return await evaluate(cdp, `
    (() => {
      const row = window.__chatOpenProbe.row(${JSON.stringify(ref.id)});
      if (row === undefined) return false;
      row.scrollIntoView({ block: "center" });
      row.click();
      return true;
    })()
  `);
}

async function revealCollapsedSessionGroups(cdp) {
  await evaluate(cdp, `
    (async () => {
      const panel = window.__chatOpenProbe.walk(document, (element) => element.tagName === "SESSION-INBOX-PANEL");
      if (panel === undefined) return false;
      const headers = [...panel.shadowRoot.querySelectorAll(".group-header[aria-expanded='false']")];
      for (const header of headers) header.click();
      await panel.updateComplete;
      return true;
    })()
  `);
}

async function clickRetry(cdp) {
  const clicked = await evaluate(cdp, `
    (() => {
      const chat = window.__chatOpenProbe.chatView();
      const button = chat?.shadowRoot?.querySelector(".chat-load-retry");
      if (button === null || button === undefined) return false;
      button.click();
      return true;
    })()
  `);
  if (clicked !== true) fail("Failed-retry screenshot setup did not find the retry button.");
}

async function forceSelectedFailure(cdp, target) {
  const forced = await evaluate(cdp, `
    (() => {
      const app = document.querySelector("pi-web-app");
      if (app === null || typeof app.setState !== "function") return false;
      app.setState({ selectedChatLoad: { kind: "failed", target: ${JSON.stringify(target)}, readability: "fresh", error: "Probe injected failure for retry screenshot" } });
      return true;
    })()
  `);
  if (forced !== true) fail("Failed-retry screenshot setup could not inject the failed selected-chat state.");
}

async function selectAndWaitReady(cdp, ref, args, label) {
  const beforeAttemptId = await latestIntentAttemptId(cdp, ref);
  await clickSessionRow(cdp, ref);
  let attemptId;
  try {
    attemptId = await waitForLatestIntentAttempt(cdp, ref, beforeAttemptId ?? 0, 1500);
  } catch {
    attemptId = undefined;
  }
  if (attemptId === undefined) {
    await waitForChatSession(cdp, ref, args.timeoutMs, label);
    return;
  }
  await waitForTerminalMilestone(cdp, attemptId, args.timeoutMs, ref);
}

async function waitForRow(cdp, ref, timeoutMs) {
  await waitForCondition(cdp, `window.__chatOpenProbe.row(${JSON.stringify(ref.id)}) !== undefined`, timeoutMs, `inbox row ${describeRef(ref)}`);
}

async function waitForChatSession(cdp, ref, timeoutMs, label) {
  await waitForCondition(cdp, `window.__chatOpenProbe.chatView()?.sessionId === ${JSON.stringify(ref.id)}`, timeoutMs, `${label} chat session ${describeRef(ref)}`);
}

async function waitForRetryButton(cdp, timeoutMs) {
  await waitForCondition(cdp, `window.__chatOpenProbe.chatView()?.shadowRoot?.querySelector(".chat-load-retry") !== null`, timeoutMs, "failed chat retry button");
}

async function waitForMilestone(cdp, attemptId, milestone, timeoutMs, ref) {
  await waitForCondition(cdp, milestoneExpression(attemptId, milestone), timeoutMs, `${milestone} for attempt ${String(attemptId)} ${describeRef(ref)}`);
}

async function waitForTerminalMilestone(cdp, attemptId, timeoutMs, ref) {
  await waitForCondition(cdp, terminalMilestoneExpression(attemptId), timeoutMs, `terminal readiness for attempt ${String(attemptId)} ${describeRef(ref)}`);
}

async function latestIntentAttemptId(cdp, ref) {
  return await evaluate(cdp, `
    (${newestIntentAttemptId.toString()})(
      performance.getEntriesByType("measure").map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, detail: entry.detail })),
      ${JSON.stringify(ref)}
    )
  `);
}

async function waitForLatestIntentAttempt(cdp, ref, afterAttemptId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const attemptId = await latestIntentAttemptId(cdp, ref);
    if (typeof attemptId === "number" && attemptId > afterAttemptId) return attemptId;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for a new intent attempt for ${describeRef(ref)}`);
}

function milestoneExpression(attemptId, milestone) {
  return `performance.getEntriesByType("measure").some((entry) => entry.name === ${JSON.stringify(`${TIMING_NAMESPACE}.measure.${milestone}`)} && entry.detail?.attemptId === ${JSON.stringify(attemptId)})`;
}

function terminalMilestoneExpression(attemptId) {
  const names = ["live-ready", "read-only-ready", "failed"].map((milestone) => `${TIMING_NAMESPACE}.measure.${milestone}`);
  return `performance.getEntriesByType("measure").some((entry) => ${JSON.stringify(names)}.includes(entry.name) && entry.detail?.attemptId === ${JSON.stringify(attemptId)})`;
}

async function waitForCondition(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, expression) === true) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function timingMeasures(cdp, attemptId) {
  return await evaluate(cdp, `
    (${measuresForAttempt.toString()})(
      performance.getEntriesByType("measure").map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, detail: entry.detail })),
      ${JSON.stringify(attemptId)}
    )
  `);
}

async function longTasksForAttempt(cdp, measures) {
  const shell = measureFor(measures, "shell-painted");
  const fresh = measureFor(measures, "fresh-transcript-painted");
  if (shell === undefined || fresh === undefined) return [];
  const shellAt = shell.startTime + shell.duration;
  const freshAt = fresh.startTime + fresh.duration;
  return await evaluate(cdp, `
    window.__chatOpenProbe.longTasks.filter((entry) => entry.startTime >= ${JSON.stringify(shellAt)} && entry.startTime <= ${JSON.stringify(freshAt)})
  `);
}

async function screenshot(cdp, args, name) {
  if (args.skipShots) return;
  const outputPath = join(args.shots, `${name}.png`);
  await mkdir(dirname(outputPath), { recursive: true });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(outputPath, Buffer.from(data, "base64"));
}

async function removeHistoryCache(cdp, ref) {
  await evaluate(cdp, `sessionStorage.removeItem(${JSON.stringify(historyCacheKey(ref))})`);
}

async function waitForHistoryCache(cdp, ref, timeoutMs) {
  await waitForCondition(cdp, `sessionStorage.getItem(${JSON.stringify(historyCacheKey(ref))}) !== null`, timeoutMs, `history cache for ${describeRef(ref)}`);
}

export function historyCacheKey(ref) {
  return `pi-web:chat-history:v2:${ref.machineId ?? "local"}:${ref.sessionId ?? ref.id}`;
}

async function representativeSessions(args) {
  const listing = await fetchJson(new URL("api/machines/local/sessions/all", ensureSlash(args.url)).toString());
  const sessions = Array.isArray(listing.sessions) ? listing.sessions.filter(isUsableSession) : [];
  if (sessions.length < 2) fail("Session catalog needs at least two non-archived sessions, or pass explicit representative ids.");

  const explicitPrevious = refFromArgs(args.previousSessionId, args.previousCwd);
  const explicitSame = refFromArgs(args.sameSessionId, args.sameCwd);
  const explicitCross = refFromArgs(args.crossSessionId, args.crossCwd);
  const explicitLarge = refFromArgs(args.largeSessionId, args.largeCwd);

  const byCwd = new Map();
  for (const session of sessions) byCwd.set(session.cwd, [...byCwd.get(session.cwd) ?? [], session]);
  const sameGroup = [...byCwd.values()].find((group) => group.length >= 2) ?? [];
  const previous = explicitPrevious ?? sessionRef(sameGroup[0] ?? sessions[0]);
  const same = explicitSame ?? sessionRef(sameGroup.find((session) => session.id !== previous.id) ?? sessions.find((session) => session.cwd === previous.cwd && session.id !== previous.id));
  const cross = explicitCross ?? sessionRef(sessions.find((session) => session.cwd !== previous.cwd));
  const largeCandidates = explicitLarge === undefined
    ? [...sessions]
      .sort((left, right) => (right.messageCount ?? 0) - (left.messageCount ?? 0))
      .slice(0, 100)
      .map(sessionRef)
      .filter((candidate) => candidate !== undefined)
    : [explicitLarge];
  const large = largeCandidates[0];

  if (same === undefined) fail("Could not discover a same-workspace target. Pass --same-session-id and --same-cwd.");
  if (cross === undefined) fail("Could not discover a cross-workspace target. Pass --cross-session-id and --cross-cwd.");
  if (large === undefined) fail("Could not discover a large-transcript target. Pass --large-session-id and --large-cwd.");
  process.stdout.write("Representatives:\n");
  process.stdout.write(`  previous        ${describeRef(previous)}\n`);
  process.stdout.write(`  same-workspace  ${describeRef(same)}\n`);
  process.stdout.write(`  cross-workspace ${describeRef(cross)}\n`);
  process.stdout.write(`  large           ${describeRef(large)}\n`);
  return { previous, same, cross, large, largeCandidates };
}

async function visibleLargeRepresentative(cdp, candidates) {
  await revealCollapsedSessionGroups(cdp);
  const visible = await evaluate(cdp, `
    (() => {
      const candidates = ${JSON.stringify(candidates)};
      return candidates.find((candidate) => window.__chatOpenProbe.row(candidate.id) !== undefined);
    })()
  `);
  if (visible === undefined) fail("Could not find any of the 100 largest non-archived catalog sessions as an inbox row. Pass an explicit visible --large-session-id and --large-cwd.");
  return visible;
}

function sourceForTarget(target, candidates) {
  const source = candidates.find((candidate) => !sameSessionRef(candidate, target));
  if (source === undefined) fail(`Could not find a source session different from ${describeRef(target)}.`);
  return source;
}

function sameSessionRef(left, right) {
  return left.id === right.id && left.cwd === right.cwd;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) fail(`Failed to fetch ${url}: ${String(response.status)} ${response.statusText}`);
  return await response.json();
}

function parseArgs(argv) {
  const parsed = {
    url: "http://127.0.0.1:8504/",
    shots: "/tmp/forgerie-chat-open-probe",
    shellBudgetMs: SHELL_BUDGET_MS,
    longTaskWarningMs: LONG_TASK_WARNING_MS,
    settleMs: 2500,
    timeoutMs: 20000,
    hydrationDelayMs: 250,
    skipShots: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--url") parsed.url = requireArg(argv, ++i, arg);
    else if (arg === "--shots") parsed.shots = requireArg(argv, ++i, arg);
    else if (arg === "--chrome-bin") parsed.chromeBin = requireArg(argv, ++i, arg);
    else if (arg === "--shell-budget-ms") parsed.shellBudgetMs = numberArg(argv, ++i, arg);
    else if (arg === "--long-task-warning-ms") parsed.longTaskWarningMs = numberArg(argv, ++i, arg);
    else if (arg === "--settle-ms") parsed.settleMs = numberArg(argv, ++i, arg);
    else if (arg === "--timeout-ms") parsed.timeoutMs = numberArg(argv, ++i, arg);
    else if (arg === "--hydration-delay-ms") parsed.hydrationDelayMs = numberArg(argv, ++i, arg);
    else if (arg === "--same-session-id") parsed.sameSessionId = requireArg(argv, ++i, arg);
    else if (arg === "--same-cwd") parsed.sameCwd = requireArg(argv, ++i, arg);
    else if (arg === "--previous-session-id") parsed.previousSessionId = requireArg(argv, ++i, arg);
    else if (arg === "--previous-cwd") parsed.previousCwd = requireArg(argv, ++i, arg);
    else if (arg === "--cross-session-id") parsed.crossSessionId = requireArg(argv, ++i, arg);
    else if (arg === "--cross-cwd") parsed.crossCwd = requireArg(argv, ++i, arg);
    else if (arg === "--large-session-id") parsed.largeSessionId = requireArg(argv, ++i, arg);
    else if (arg === "--large-cwd") parsed.largeCwd = requireArg(argv, ++i, arg);
    else if (arg === "--skip-shots") parsed.skipShots = true;
    else fail(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  return parsed;
}

function requireArg(argv, index, name) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value.`);
  return value;
}

function numberArg(argv, index, name) {
  const value = Number(requireArg(argv, index, name));
  if (!Number.isFinite(value) || value < 0) fail(`${name} requires a non-negative number.`);
  return value;
}

function refFromArgs(id, cwd) {
  if (id === undefined && cwd === undefined) return undefined;
  if (id === undefined || cwd === undefined) fail("Representative session arguments require both id and cwd.");
  return { id, sessionId: id, cwd, machineId: "local" };
}

function sessionRef(session) {
  if (session === undefined) return undefined;
  return { id: session.id, sessionId: session.id, cwd: session.cwd, machineId: "local" };
}

function isUsableSession(session) {
  return typeof session.id === "string" && session.id !== "" && typeof session.cwd === "string" && session.cwd !== "" && session.archived !== true;
}

function describeRef(ref) {
  return `${ref.machineId ?? "local"}:${ref.id} cwd=${ref.cwd}`;
}

function durationFor(measures, milestone) {
  return measureFor(measures, milestone)?.duration;
}

function measureFor(measures, milestone) {
  return measures.find((entry) => entry.detail?.milestone === milestone);
}

export function newestIntentAttemptId(entries, ref) {
  let latest;
  for (const entry of entries) {
    const attemptId = entry.detail?.attemptId;
    if (entry.name !== "forgerie.chat-open.measure.intent") continue;
    if (entry.detail?.milestone !== "intent") continue;
    if (entry.detail?.target?.sessionId !== ref.id || entry.detail?.target?.cwd !== ref.cwd) continue;
    if ((entry.detail?.target?.machineId ?? "local") !== (ref.machineId ?? "local")) continue;
    if (typeof attemptId !== "number") continue;
    latest = latest === undefined ? attemptId : Math.max(latest, attemptId);
  }
  return latest;
}

export function measuresForAttempt(entries, attemptId) {
  return entries
    .filter((entry) => entry.name.startsWith("forgerie.chat-open") && entry.detail?.attemptId === attemptId)
    .sort((left, right) => left.startTime - right.startTime || left.duration - right.duration);
}

function formatMs(value) {
  return value === undefined ? "n/a" : `${value.toFixed(1)}ms`;
}

function ensureSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) await main();
