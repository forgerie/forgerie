#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Run from ui/. Captures production Caliper scenarios, all measured Fold viewports and both themes.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } from '../../scripts/lib/cdp.mjs';
import { openPosturePage } from '../../scripts/lib/posture-page.mjs';
import { FOLD8_POSTURES } from '../../scripts/lib/fold8-postures.mjs';
const out = process.env.OUT ?? '/tmp/child-controls-shots';
const origin = process.env.APP_URL ?? 'http://127.0.0.1:8538';
const states = process.argv.slice(2);
if (!states.length) states.push('default','ChildAsking','ChildStreaming','ChildIdle','Finished','Dirty','Landed','Discarded','Discard','Changes','Runs','Cleanup','Conflict','Blocked','Stale','Empty','Failed');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'child-controls-chrome-'));
const port = await getFreePort();
const chrome = launchChrome(spawnSync('which', ['chromium'], {encoding:'utf8'}).stdout.trim(), port, profile);
const results = [];
try {
 await waitForDebugger(port);
 for (const state of states) for (const scheme of ['light','dark']) for (const posture of FOLD8_POSTURES) {
  const cdp = await openPosturePage({ debugPort:port, posture, colorScheme:scheme });
  await cdp.send('Page.navigate', {url:`${origin}/verification/child-controls-parts.html?state=${state}`});
  const deadline = Date.now()+15000;
  while (!await evaluate(cdp, '!!document.querySelector("dialog[open]")')) { if (Date.now()>deadline) throw new Error(`No dialog: ${state}`); await sleep(50); }
  await sleep(350);
  const facts = await evaluate(cdp, `(() => {
    const buttons = [...document.querySelectorAll('.sheet-dialog-head button,.sheet-dialog-foot button')];
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      unreachable: buttons.filter(b=>{ const r=b.getBoundingClientRect(); return r.left<0 || r.top<0 || r.right>innerWidth || r.bottom>innerHeight; }).map(b=>b.textContent || b.getAttribute('aria-label')) };
  })()`);
  if (facts.overflow || facts.unreachable.length) throw new Error(`${state} ${scheme} ${posture.name}: ${JSON.stringify(facts)}`);
  const file = `${out}/${state}-${scheme}-${posture.name}.png`;
  await writeFile(file, Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  results.push({state,scheme,posture:posture.name,file,...facts});
  cdp.close();
 }
 await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));
 console.log(`${results.length} production-state captures; no page overflow or unreachable header/footer actions`);
} finally { chrome.kill(); await sleep(300); await rm(profile,{recursive:true,force:true,maxRetries:5}); }
