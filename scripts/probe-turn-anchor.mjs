#!/usr/bin/env node
// Drives the transcript's turn anchoring in a real browser and reports the
// geometry the behaviour is defined by: where the opening message of a turn
// sits while the reply streams in underneath it.
//
//   node scripts/probe-turn-anchor.mjs --url "http://127.0.0.1:8505/?project=...&session=..."
//
// Messages are injected straight onto the <chat-view> element's `messages`
// property, so the probe exercises real layout without spending an agent run.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "./lib/fold8-postures.mjs";

const SETUP = `
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
    const view = walk(document, (element) => element.tagName === "CHAT-VIEW");
    if (!view) return "no chat-view";
    // The probe takes ownership of the transcript's messages so the surrounding
    // app cannot overwrite the injected turn between measurements.
    let held = view.messages.slice();
    Object.defineProperty(view, "messages", {
      configurable: true,
      get: () => held,
      set: () => undefined,
    });
    window.__probe = {
      view,
      chat: () => view.renderRoot.querySelector(".chat"),
      baseline: held.slice(),
      inject: (messages) => {
        const previous = held;
        held = messages;
        view.requestUpdate("messages", previous);
        return view.updateComplete;
      },
    };
    return "ok";
  })()
`;

const line = (role, text) => ({ role, parts: [{ type: "text", text }] });

/** Raise an open question inside the running turn. */
const ASK_A_QUESTION = `
  (async () => {
    const view = window.__probe.view;
    view.pendingAsk = {
      askId: "probe-ask",
      askedAt: new Date().toISOString(),
      questions: [{
        id: "probe",
        question: "PROBE: is this question reachable and does it stay put while scrolling?",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      }],
    };
    await view.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return "asked";
  })()
`;

/** Scroll up past the open question and report whether it stayed pinned to the top. */
const SCROLL_PAST_THE_QUESTION = `
  (async () => {
    const probe = window.__probe;
    const chat = probe.chat();
    const card = chat.querySelector("ask-user-card.open-ask-card");
    if (card === null) return "no open question rendered";
    const before = Math.round(card.getBoundingClientRect().top - chat.getBoundingClientRect().top);
    chat.scrollTop = Math.max(0, chat.scrollTop - 300);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = Math.round(card.getBoundingClientRect().top - chat.getBoundingClientRect().top);
    return "cardTop " + String(before) + " -> " + String(after) + " after scrolling up 300px";
  })()
`;

/** Move the scroller the way a reader would: the transcript did not write this offset. */
const READER_SCROLL_TO_BOTTOM = `
  (async () => {
    const chat = window.__probe.chat();
    chat.scrollTop = chat.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return JSON.stringify(window.__probe.view.followMode ?? null);
  })()
`;

function injectScript(messages) {
  return `
    (async () => {
      const probe = window.__probe;
      await probe.inject(${JSON.stringify(messages)});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const chat = probe.chat();
      const turns = [...chat.querySelectorAll(".turn")];
      const last = turns[turns.length - 1];
      const chatRect = chat.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const liveness = chat.querySelector("transcript-liveness");
      const beforeLiveness = liveness === null ? null : liveness.previousElementSibling;
      const livenessGap = liveness === null || beforeLiveness === null
        ? "none"
        : String(Math.round(liveness.getBoundingClientRect().top - beforeLiveness.getBoundingClientRect().bottom))
          + " after " + beforeLiveness.tagName.toLowerCase() + "." + String(beforeLiveness.className || "-");
      return {
        livenessGap,
        turnKey: last.dataset.turnKey,
        turnCount: turns.length,
        turnChildren: last.childElementCount,
        turnTextLength: last.textContent.length,
        turnHtmlLength: last.outerHTML.length,
        rowFit: [
          "turnBottom" + String(Math.round(last.offsetTop + last.offsetHeight)),
          "scrollHeight" + String(chat.scrollHeight),
          "nextTop" + String(last.nextElementSibling === null ? -1 : Math.round(last.nextElementSibling.getBoundingClientRect().top - chatRect.top + chat.scrollTop)),
          "nextTag" + String(last.nextElementSibling === null ? "none" : last.nextElementSibling.tagName),
        ].join(" "),
        turnBox: [
          "rect" + String(Math.round(lastRect.height)),
          "offset" + String(last.offsetHeight),
          "scroll" + String(last.scrollHeight),
          getComputedStyle(last).display,
          "min:" + getComputedStyle(last).minBlockSize,
          "contain:" + getComputedStyle(last).contain,
        ].join(" "),
        messageCount: probe.view.messages.length,
        childHeights: [...last.children].map((child) => child.tagName + ":" + String(Math.round(child.getBoundingClientRect().height))).join(","),
        turnTopOffset: Math.round(lastRect.top - chatRect.top),
        turnHeight: Math.round(lastRect.height),
        reserved: last.querySelector(".turn-body")?.classList.contains("reserved") === true,
        scrollTop: Math.round(chat.scrollTop),
        scrollHeight: Math.round(chat.scrollHeight),
        clientHeight: Math.round(chat.clientHeight),
        followMode: JSON.stringify(probe.view.followMode ?? null),
      };
    })()
  `;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-probe-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      process.stdout.write(`\n== ${posture.name} (${posture.width}x${posture.height})\n`);
      await probePosture({ debugPort, posture, args });
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function probePosture({ debugPort, posture, args }) {
  const cdp = await openPage(debugPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: posture.width,
      height: posture.height,
      deviceScaleFactor: FOLD8_DPR,
      mobile: true,
    });
    const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await loaded;
    await sleep(args.settle);

    const ready = await evaluate(cdp, SETUP);
    if (ready !== "ok") fail(`setup failed: ${String(ready)}`);

    const baseline = await evaluate(cdp, `window.__probe.baseline.length`);
    const history = await evaluate(cdp, `JSON.parse(JSON.stringify(window.__probe.baseline))`);
    process.stdout.write(`  transcript already holds ${String(baseline)} messages\n`);

    const asked = [...history, line("user", "PROBE: does the opening message hold the top of the viewport?")];
    report("turn opens", await evaluate(cdp, injectScript(asked)));
    await screenshot(cdp, args, `${posture.name}-turn-opens`);

    if (args.ask === true) {
      await evaluate(cdp, ASK_A_QUESTION);
      await screenshot(cdp, args, `${posture.name}-open-question`);
      const stuck = await evaluate(cdp, SCROLL_PAST_THE_QUESTION);
      process.stdout.write(`  ${"question while scrolling".padEnd(24)} ${String(stuck)}\n`);
      await screenshot(cdp, args, `${posture.name}-open-question-scrolled`);
    }

    const paragraph = "The reply streams in underneath the question. ".repeat(12);
    let streamed = asked;
    for (let step = 1; step <= 3; step += 1) {
      streamed = [...asked, line("assistant", `${String(step)}. ${paragraph}`)];
      report(`reply grows (${String(step)})`, await evaluate(cdp, injectScript(streamed)));
    }

    await screenshot(cdp, args, `${posture.name}-short-reply`);

    const long = [...asked, line("assistant", `${paragraph}\n\n`.repeat(14))];
    report("reply outgrows screen", await evaluate(cdp, injectScript(long)));
    await screenshot(cdp, args, `${posture.name}-long-reply`);

    const afterReaderScroll = await evaluate(cdp, READER_SCROLL_TO_BOTTOM);
    process.stdout.write(`  ${"reader scrolls to foot".padEnd(24)} mode=${String(afterReaderScroll)}\n`);
    report("reply grows again", await evaluate(cdp, injectScript([...long, line("assistant", `tail ${paragraph}`)])));
  } finally {
    cdp.close();
  }
}

async function screenshot(cdp, args, name) {
  if (args.shots === undefined) return;
  await mkdir(args.shots, { recursive: true });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(args.shots, `${name}.png`), Buffer.from(data, "base64"));
}

function report(label, result) {
  const bottomGap = result.scrollHeight - result.scrollTop - result.clientHeight;
  process.stdout.write(
    `  ${label.padEnd(24)} turnTop=${String(result.turnTopOffset).padStart(5)} `
    + `turnH=${String(result.turnHeight).padStart(5)} reserved=${String(result.reserved).padEnd(5)} `
    + `scrollTop=${String(result.scrollTop).padStart(6)} bottomGap=${String(Math.round(bottomGap)).padStart(5)} `
    + `fit=[${result.rowFit}] livenessGap=[${result.livenessGap}] mode=${result.followMode}\n`,
  );
}

function parseArgs(argv) {
  const parsed = { settle: 6000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else if (arg === "--shots") parsed.shots = argv[++i];
    else if (arg === "--ask") parsed.ask = true;
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
