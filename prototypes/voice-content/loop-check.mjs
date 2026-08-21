// End-to-end check of the spoken loop, with no human in the room.
//
// Kokoro speaks a command into a WAV file, Chromium plays that file as the
// microphone, and the page has to hear it: worklet -> Smart Turn -> Whisper ->
// intent -> engine reaction. Failures here are real failures of the voice path.
//
// The server must already be running. Usage:
//   BASE=http://127.0.0.1:8789 node loop-check.mjs "what are you doing"

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeArgs, findChrome, getFreePort, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env["BASE"] ?? "http://127.0.0.1:8789";
const phrase = process.argv[2] ?? "what are you doing";
// Delay the phrase to make it land at a chosen moment in the run.
const delayMs = Number(process.env["DELAY_MS"] ?? 400);
const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) {
  process.stderr.write("Chromium not found. Set CHROME_BIN.\n");
  process.exit(1);
}

const tempRoot = await mkdtemp(join(tmpdir(), "voice-loop-"));
const spoken = join(tempRoot, "spoken.wav");
const microphone = join(tempRoot, "microphone.wav");

const response = await fetch(`${base}/api/tts`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: phrase, voice: "af_heart" }),
});
if (!response.ok) {
  process.stderr.write(`TTS failed: ${response.status}\n`);
  process.exit(1);
}
await writeFile(spoken, Buffer.from(await response.arrayBuffer()));

// Chromium's fake capture wants 16-bit PCM and loops the file. The trailing
// silence is what the endpointer needs to decide the turn is over.
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", spoken,
  "-af", `adelay=${delayMs},apad=pad_dur=2.5`,
  "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le",
  microphone,
]);

const port = await getFreePort();
const chrome = spawn(
  chromeBin,
  [
    ...chromeArgs(port, join(tempRoot, "profile"), "932,553").slice(0, -1),
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${microphone}%noloop`,
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let failed = false;
try {
  await waitForDebugger(port);
  const cdp = await openPage(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const loaded = cdp.waitForEvent("Page.loadEventFired", 15000).catch(() => undefined);
  await cdp.send("Page.navigate", { url: `${base}/?variant=follow&autostart&speed=2&mic=hands-free&mute` });
  await loaded;

  const heard = await waitFor(cdp, "window.__voiceContent?.engine.state.userTurns.length > 0", delayMs + 45000)
    .then(() => evaluate(cdp, "window.__voiceContent.engine.state.userTurns"))
    .catch(() => undefined);

  if (heard === undefined) {
    failed = true;
    process.stderr.write(`the page never heard "${phrase}"\n`);
    const listening = await evaluate(cdp, "window.__voiceContent.view().listening").catch(() => "?");
    process.stderr.write(`listening state: ${String(listening)}\n`);
  } else {
    process.stdout.write(`said: ${phrase}\n`);
    for (const turn of heard) process.stdout.write(`heard: ${turn.text}  -> intent ${turn.intent}\n`);
    const replies = await evaluate(cdp, "window.__voiceContent.engine.state.spokenLog.filter((act) => act.type === 'reply').map((act) => act.text)");
    for (const reply of replies) process.stdout.write(`replied: ${reply}\n`);
    if (replies.length === 0) {
      failed = true;
      process.stderr.write("the engine never answered what it heard\n");
    }
  }
  cdp.close();
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await evaluate(cdp, expression)) === true) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${expression}`);
}
