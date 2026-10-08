#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
// The shipped components, on synthetic records. No Azure requests or live session writes.
const root = process.env.FORGERIE_ROOT ?? resolve(import.meta.dirname, '../../..');
const { getFreePort, launchChrome, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(root, 'scripts/lib/cdp.mjs')));
const { openPosturePage } = await import(pathToFileURL(join(root, 'scripts/lib/posture-page.mjs')));
const { FOLD8_POSTURES, FOLD8_DPR } = await import(pathToFileURL(join(root, 'scripts/lib/fold8-postures.mjs')));
const out = resolve(process.env.SHOT_DIR ?? 'verification/local/azure-backlog');
await mkdir(out, { recursive: true });
const base = new URL('/verification/github-backlog.html', process.env.APP_URL ?? 'http://127.0.0.1:8510/');
const profile = await mkdtemp(join(tmpdir(), 'azure-browser-'));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN ?? 'chromium', port, profile);
const results = [];
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: 'dark' });
  for (const state of ['azure-item', 'azure-auth', 'azure-list']) {
    await cdp.send('Page.navigate', { url: `${base.href}?state=${state}` });
    for (let i = 0; i < 100 && !(await evaluate(cdp, `!!document.querySelector('.bl-column,.bl-item')`)); i++) await sleep(100);
    if (state === 'azure-item') await evaluate(cdp, `document.querySelector('[aria-label="Item commands"]').click()`);
    if (state === 'azure-auth') await evaluate(cdp, `document.querySelector('.bl-problems summary').click()`);
    if (state === 'azure-list') await evaluate(cdp, `(() => { const input=document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#42'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    for (const scheme of ['dark', 'light']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const posture of FOLD8_POSTURES) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: posture.width, height: posture.height, deviceScaleFactor: FOLD8_DPR, mobile: true });
        await sleep(150);
        const checks = await evaluate(cdp, `(() => {
          const within = (node) => { const r=node.getBoundingClientRect(); return r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1; };
          const start=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Start session');
          const menu=document.querySelector('[role="menu"]');
          const details=document.querySelector('.bl-problems');
          return { viewport: [innerWidth,innerHeight], overflow: document.documentElement.scrollWidth>innerWidth || [...document.querySelectorAll('.settings-scroll,.settings-column')].some(n=>n.scrollWidth>n.clientWidth+1),
            start: !start || within(start), menu: !menu || within(menu), menuKept: !!menu, detailsKept: !!details?.open,
            filter: document.querySelector('input[type="search"]')?.value, rows: document.querySelectorAll('.bl-row').length,
            azureFailure: document.body.textContent.includes('Replace the expired or revoked token'), githubSetup: !!document.querySelector('.bl-github') };
        })()`);
        assert.deepEqual(checks.viewport, [posture.width, posture.height]);
        assert.equal(checks.overflow, false);
        assert.equal(checks.start, true);
        assert.equal(checks.menu, true);
        if (state==='azure-item') assert.equal(checks.menuKept,true);
        if (state==='azure-auth') { assert.equal(checks.detailsKept,true); assert.equal(checks.azureFailure,true); assert.equal(checks.githubSetup,false); }
        if (state==='azure-list') { assert.equal(checks.filter,'#42'); assert.equal(checks.rows,1); }
        results.push({state,scheme,posture:posture.name,...checks});
        if (state==='azure-auth') {
          const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          await writeFile(join(out, `auth-open-${scheme}-${posture.name}.png`),Buffer.from(shot.data,'base64'));
        }
      }
    }
  }
  await writeFile(join(out, 'browser-checks.json'),JSON.stringify(results,null,2));
  console.log(`Passed ${results.length} state/theme/posture checks, including fold/rotate state preservation.`);
} finally {
  cdp?.close(); chrome.kill('SIGTERM'); await sleep(250); if(chrome.exitCode===null)chrome.kill('SIGKILL');
  await rm(profile,{recursive:true,force:true});
}
