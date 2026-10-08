#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Exercises actual streamed updates through the network-free preview runtime.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const profile = await mkdtemp(join(tmpdir(), "aui-streamdown-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const output = resolve("verification/local/streamdown");
const result = { postures: [], errors: [], apiRequests: [], remoteMedia: [] };
await mkdir(output, { recursive: true });
try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      try {
        await cdp.send("Network.enable");
        await cdp.send("Browser.grantPermissions", { origin: new URL(base).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
        cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
        cdp.listeners.set("Network.requestWillBeSent", [(event) => {
          const url = new URL(event.request.url);
          if (url.pathname.startsWith("/api/")) result.apiRequests.push(url.href);
          if (url.hostname === "example.test") result.remoteMedia.push(url.href);
        }]);
        async function until(expression) {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            if (await evaluate(cdp, expression)) return;
            await sleep(30);
          }
          throw new Error(`Timed out: ${expression}`);
        }
        await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=streamdown-live", base).href });
        await until(`document.querySelector('[data-composer-input]') && !document.querySelector('[data-composer-input]').disabled`);
        await evaluate(cdp, `document.querySelector('[data-composer-input]').focus()`);
        await cdp.send("Input.insertText", { text: "Show the streaming Markdown renderer." });
        await evaluate(cdp, `document.querySelector('[aria-label="Send message"]').click()`);
        await until(`document.querySelector('.markdown strong')?.textContent === 'unfinished'`);
        assert.equal(await evaluate(cdp, `document.querySelector('.markdown').dataset.status`), "running");
        await evaluate(cdp, `document.querySelector('[data-composer-input]').dataset.testIdentity = 'same-input'; document.querySelector('[data-composer-input]').focus()`);
        await cdp.send("Input.insertText", { text: "Keep this next draft" });
        await until(`document.querySelector('.code-body code')?.textContent.includes('const count =')`);
        assert.equal(await evaluate(cdp, `!!document.querySelector('.code-body .hljs-keyword')`), false);
        await until(`document.querySelector('.markdown table') && document.querySelector('.markdown').dataset.status === 'running'`);
        assert.equal(await evaluate(cdp, `document.querySelector('.markdown a[href]') !== null`), false);
        await until(`document.querySelector('.markdown').dataset.status === 'complete'`);
        assert.equal(await evaluate(cdp, `document.querySelector('.code-body code').textContent`), "const count = 1;\n");
        assert.equal(await evaluate(cdp, `document.querySelector('.code-body .hljs-keyword').textContent`), "const");
        assert.equal(await evaluate(cdp, `document.querySelector('.markdown a').getAttribute('href')`), "https://example.test/complete");
        assert.equal(await evaluate(cdp, `document.querySelectorAll('.markdown :is(img, iframe, script)').length`), 0);
        assert.equal(await evaluate(cdp, `document.querySelector('[data-composer-input]').dataset.testIdentity`), "same-input");
        assert.equal(await evaluate(cdp, `document.querySelector('[data-composer-input]').value`), "Keep this next draft");
        assert.equal(await evaluate(cdp, `document.querySelectorAll('.message-assistant').length`), 1);
        await evaluate(cdp, `document.querySelector('[aria-label="Copy code"]').click()`);
        await until(`document.querySelector('.code-header .copy-status')?.textContent === 'Copied'`);
        assert.equal(await evaluate(cdp, `navigator.clipboard.readText()`), "const count = 1;\n");
        const metrics = await evaluate(cdp, `({
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          codeFocusable: document.querySelector('.code-body').tabIndex === 0,
          tableFocusable: document.querySelector('.table-scroll').tabIndex === 0,
          draft: document.querySelector('[data-composer-input]').value,
          inputSame: document.querySelector('[data-composer-input]').dataset.testIdentity === 'same-input',
          tableRows: document.querySelectorAll('table tr').length,
          strongWeight: getComputedStyle(document.querySelector('.markdown strong')).fontWeight
        })`);
        assert.equal(metrics.pageOverflow, false);
        assert.equal(metrics.codeFocusable, true);
        assert.equal(metrics.tableFocusable, true);
        assert.equal(metrics.tableRows, 2);
        assert.equal(metrics.strongWeight, "600");
        result.postures.push({ scheme, posture: posture.name, ...metrics });
      } finally { cdp.close(); }
    }
  }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.apiRequests, []);
  assert.deepEqual(result.remoteMedia, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
