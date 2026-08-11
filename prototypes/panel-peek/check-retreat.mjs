/**
 * Push an open sheet back out and let go, from several distances and from both
 * on the sheet and beside it.
 *
 * This exists because pushing a sheet back was not the mirror of pulling it in.
 * The first move of a retreat tracked; the second was re-read as an opening
 * drag running backwards, so the sheet collapsed under the finger and vanished
 * on release. The trace read:
 *
 *   s1  T0.983  T0.983  T0.983  T0  T0  ...  gone
 *
 * A pass springs the sheet back open for small retreats and closes it only for
 * a retreat that carried it most of the way out.
 *
 * Usage: FORGERIE_SESSION=<id> node check-retreat.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const PORT=9345; const SESSION=process.env["FORGERIE_SESSION"]??""; let nextId=0;
const chrome=spawn("chromium",["--headless=new","--disable-gpu","--no-sandbox",`--remote-debugging-port=${String(PORT)}`,"about:blank"],{stdio:"ignore"});
process.on("exit",()=>{chrome.kill();});
const s=await connect(await waitForTarget());
await send(s,"Emulation.setDeviceMetricsOverride",{width:739,height:979,deviceScaleFactor:1,mobile:true});
await send(s,"Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send(s,"Page.enable",{});
await send(s,"Page.navigate",{url:`http://127.0.0.1:8504/?session=${SESSION}`}); await delay(6000);
await ev(s,`(() => { const deep=(r,sel)=>{const sc=r.shadowRoot??r;const h=sc.querySelector(sel);if(h)return h;
  for(const c of sc.querySelectorAll("*")){if(c.shadowRoot){const f=deep(c,sel);if(f)return f;}}return null;};
  const row=deep(document.querySelector("pi-web-app"),".row"); if(row) row.click(); return "ok"; })()`);
await delay(5000);

// Sheet is 360 wide on a 739 shell. x=150 is on the sheet, x=600 is the scrim.
for (const start of [150, 600]) {
  for (const retreat of [6, 30, 120, 300]) {
    await openSheet();
    const before = await sheetState();
    // Watch the sheet through the whole gesture.
    await ev(s, `(() => { globalThis.trace = []; const app = document.querySelector("pi-web-app");
      globalThis.tick = setInterval(() => { const el = app.shadowRoot.querySelector(".peek-sheet");
        globalThis.trace.push(el === null ? "gone" : (el.hasAttribute("data-tracking") ? "T" : "s") + (el.style.getPropertyValue("--peek-progress") || "?"));
      }, 25); return "watching"; })()`);
    await dragFrom(start, 480, -retreat);
    await delay(600);
    await ev(s, `(() => { clearInterval(globalThis.tick); return "x"; })()`);
    const after = await sheetState();
    console.log(`start x=${String(start).padStart(3)} retreat ${String(retreat).padStart(3)}px : ${before} -> ${after}`);
  }
}
chrome.kill();

async function openSheet(){
  await ev(s,`(() => {const sc=document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-scrim"); if(sc) sc.click(); return "x";})()`);
  await delay(300);
  await send(s,"Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:20,y:480}]});
  for(let t=15;t<=340;t+=15){await send(s,"Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:20+t,y:480}]});await delay(12);}
  await send(s,"Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await delay(400);
}
async function dragFrom(x,y,dx){
  await send(s,"Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
  const steps=Math.max(1,Math.round(Math.abs(dx)/6));
  for(let i=1;i<=steps;i+=1){await send(s,"Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+Math.round(dx*i/steps),y}]});await delay(14);}
  await send(s,"Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
}
async function sheetState(){return ev(s,`(() => {const el=document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-sheet");
  return el===null?"CLOSED":"open@"+(el.style.getPropertyValue("--peek-progress")||"?");})()`);}
async function ev(k,e){const r=await send(k,"Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)return "threw"; return String(r.result?.value);}
async function waitForTarget(){for(let i=0;i<50;i+=1){try{const res=await fetch(`http://127.0.0.1:${String(PORT)}/json/list`);
  const p=(await res.json()).find(t=>t.type==="page");if(p)return p.webSocketDebuggerUrl;}catch{}await delay(200);}throw new Error("no target");}
function connect(u){return new Promise((res,rej)=>{const k=new WebSocket(u);k.addEventListener("open",()=>{res(k);});k.addEventListener("error",rej);});}
function send(k,method,params){const id=(nextId+=1);return new Promise((res,rej)=>{const on=(e)=>{const m=JSON.parse(e.data);if(m.id!==id)return;
  k.removeEventListener("message",on);if(m.error)rej(new Error(m.error.message));else res(m.result);};k.addEventListener("message",on);k.send(JSON.stringify({id,method,params}));});}
