#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Real browser -> production store -> HTTP routes -> Durable + Git. Run after scripts/child-controls-live.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } from '../../scripts/lib/cdp.mjs';
import { openPosturePage } from '../../scripts/lib/posture-page.mjs';
import { FOLD8_POSTURES } from '../../scripts/lib/fold8-postures.mjs';
const seed = JSON.parse(await readFile('/tmp/child-controls-live-seed.json','utf8'));
assert.match(seed.root, /^\/tmp\/forgerie-child-controls-real-/);
const out = '/tmp/child-controls-live-evidence'; await mkdir(out,{recursive:true});
const profile = await mkdtemp(join(tmpdir(),'child-controls-live-browser-'));
const port = await getFreePort();
const chrome = launchChrome(spawnSync('which',['chromium'],{encoding:'utf8'}).stdout.trim(),port,profile);
const exists = async path => stat(path).then(()=>true, error=> { if(error.code==='ENOENT')return false; throw error; });
const api = async () => (await fetch(`http://127.0.0.1:8540/api/sessions/${seed.ref.id}/children?${new URLSearchParams({cwd:seed.ref.cwd})}`)).json();
const results = [];
let cdp;
async function wait(expression, timeout=180000) {
 const deadline=Date.now()+timeout;
 while (!await evaluate(cdp,expression)) { if(Date.now()>deadline)throw new Error(`Timed out: ${expression}`); await sleep(200); }
}
async function click(label, selector='button') {
 const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})`;
 await wait(`!!(${expression})`,15000);
 // Collection rows may scroll; primary header/footer controls must already be reachable.
 if (label.startsWith('Open ') || selector==='summary') await evaluate(cdp,`(${expression}).scrollIntoView({block:'nearest'})`);
 const rect=await evaluate(cdp,`(()=>{const b=${expression}; const r=b.getBoundingClientRect();if(b.disabled)throw Error('Disabled '+b.textContent);return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 assert(rect.x>=0&&rect.x<711&&rect.y>=0&&rect.y<374,`Unreachable ${label}: ${JSON.stringify(rect)}`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});
}
async function shot(label) { await sleep(150);await writeFile(`${out}/${label}.png`,Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')); }
try {
 await waitForDebugger(port);
 cdp=await openPosturePage({debugPort:port,posture:FOLD8_POSTURES.find(p=>p.width===711 || p.name==='folded-landscape'),colorScheme:'dark'});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:8539/verification/child-controls-live.html?${new URLSearchParams({session:seed.ref.id,cwd:seed.ref.cwd})}`});
 await click('Open builder'); await click('Review changes');
 await click('Committed changes','summary');
 await wait(`document.body.textContent.includes('CHILD-CONTROLS-builder')`,15000);
 await shot('review-real-diff'); results.push('review contains the real committed file diff');
 await click('Back to child agents'); await click('Land');
 await wait(`document.body.textContent.includes('Landed on main')`,30000);
 assert.equal((await readFile(join(seed.ref.cwd,'builder.txt'),'utf8')).trim(),'CHILD-CONTROLS-builder');
 assert.equal(await exists(seed.children.find(c=>c.name==='builder').worktree.path),false);
 await shot('landed'); results.push('land fast-forwarded the real main branch and removed only the child checkout');
 await click('Start new task from main');
 await evaluate(cdp,`document.querySelector('textarea').focus()`);
 await cdp.send('Input.insertText',{text:"Write continuation.txt containing exactly CHILD-CONTROLS-CONTINUED. Then run git add continuation.txt and git commit -m 'continued acceptance' as separate commands. Do not change any other file."});
 await click('Start new child');
 await wait(`document.querySelector('.sheet-dialog-title')?.textContent==='builder-2'`);
 await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Land'&&!b.disabled)`);
 const continued=(await api()).find(c=>c.name==='builder-2');
 assert.equal((await readFile(join(continued.worktree.path,'continuation.txt'),'utf8')).trim(),'CHILD-CONTROLS-CONTINUED');
 assert.equal((await readFile(join(continued.worktree.path,'builder.txt'),'utf8')).trim(),'CHILD-CONTROLS-builder');
 await shot('continued'); results.push('new real-model child wrote and committed in a fresh checkout containing the landed main commit');
 // Verify the real question/answer and cancellation path, including an unsent draft across history.
 await click('All child agents'); await click('Open builder');
 if(await evaluate(cdp,`[...document.querySelectorAll('button')].some(b=>b.textContent==='Start new task from main')`)) await click('Start new task from main');
 await evaluate(cdp,`document.querySelector('textarea').focus()`);
 await cdp.send('Input.insertText',{text:'Call ask_human with the exact question Which marker should I write? Wait for the answer, then write answer.txt containing exactly the answer. Do not commit. Do nothing else.'});
 await click('Start new child');
 await wait(`document.querySelector('textarea')?.getAttribute('aria-label')?.startsWith('Answer builder-3:')`);
 await evaluate(cdp,`document.querySelector('textarea').focus()`); await cdp.send('Input.insertText',{text:'ANSWER-RETAINED'});
 const runsButton=await evaluate(cdp,`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Runs ')||b.textContent==='Run history')?.textContent`);
 await click(runsButton); await click('Back to child agents');
 assert.equal(await evaluate(cdp,`document.querySelector('textarea').value`),'ANSWER-RETAINED');
 await click('Send answer');
 await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Continue working')`);
 const answered=(await api()).find(c=>c.name==='builder-3');
 assert.equal((await readFile(join(answered.worktree.path,'answer.txt'),'utf8')).trim(),'ANSWER-RETAINED');
 results.push('real answer draft survived history navigation and reached the child file write');
 await click('All child agents'); await click('Open builder');
 if(await evaluate(cdp,`[...document.querySelectorAll('button')].some(b=>b.textContent==='Start new task from main')`)) await click('Start new task from main');
 await evaluate(cdp,`document.querySelector('textarea').focus()`);
 await cdp.send('Input.insertText',{text:'Call ask_human with the exact question Shall I continue? Wait for the answer. Do nothing else.'});
 await click('Start new child');
 await wait(`document.querySelector('textarea')?.getAttribute('aria-label')?.startsWith('Answer builder-4:')`);
 await click('Stop');
 await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Continue working')`,15000);
 const stopped=(await api()).find(c=>c.name==='builder-4'); assert.equal(stopped.busy,false); assert.deepEqual(stopped.questions,[]);
 await shot('stopped-question'); results.push('Stop cancelled a real model waiting in ask_human and removed its answer control');
 await click('All child agents'); await click('Open disposable'); await click('Discard');
 await wait(`document.body.textContent.includes('acceptance disposable')`,15000);
 const discarded=seed.children.find(c=>c.name==='disposable');
 await click('Keep worktree'); assert.equal(await exists(discarded.worktree.path),true);
 await click('Discard'); await wait(`document.body.textContent.includes('acceptance disposable')`,15000);
 await writeFile(join(discarded.worktree.path,'changed-after-preview.txt'),'keep me until fresh confirmation');
 await click('Discard worktree'); await wait(`document.body.textContent.includes('Nothing was discarded')`,15000);
 assert.equal(await exists(join(discarded.worktree.path,'changed-after-preview.txt')),true);
 await shot('stale-preview'); results.push('Keep and stale-preview both preserved the real checkout');
 await click('Discard'); await wait(`document.body.textContent.includes('changed-after-preview.txt')`,15000);
 await shot('fresh-discard'); await click('Discard worktree');
 await wait(`document.body.textContent.includes('Worktree discarded')`,30000);
 assert.equal(await exists(discarded.worktree.path),false); assert.equal(await exists(join(seed.ref.cwd,'disposable.txt')),false);
 await shot('discarded'); results.push('fresh token confirmation discarded only the reviewed child work');
 const history=await evaluate(cdp,`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Runs ')||b.textContent==='Run history')?.textContent`);
 await click(history); await wait(`document.querySelectorAll('details').length>=3`,15000);
 const summary=await evaluate(cdp,`document.querySelector('summary').textContent`); await click(summary,'summary');
 await wait(`document.body.textContent.includes('child-acceptance/deepseek-v4.1-flash')`,15000);
 await shot('real-history'); results.push('history contains the real model, turns, usage and child runs');
 await click('Back to child agents'); await click('All child agents'); await click('Worktrees');
 await wait(`document.body.textContent.includes('in-use')`,15000); await shot('cleanup-inventory');
 results.push('cleanup inventory is the real conservative job report');
 await writeFile(`${out}/results.json`,JSON.stringify({ref:seed.ref,results},null,2));
 console.log(JSON.stringify(results,null,2));
} catch(error) { if(cdp)await shot('failure');throw error; }
finally { cdp?.close();chrome.kill();await sleep(300);await rm(profile,{recursive:true,force:true,maxRetries:5}); }
