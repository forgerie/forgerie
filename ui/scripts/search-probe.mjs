#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Measures session search at every Fold posture and both schemes, against the
// app served over the search fixture API (scripts/search-fixture-server.mjs).
// It drives real keys: Ctrl+K, the query, and optionally a press on one hit,
// then reports boxes, overflow, clipped controls and colours as JSON.
//   APP_URL=http://127.0.0.1:8571/ node scripts/search-probe.mjs hits
//   APP_URL=http://127.0.0.1:8571/ node scripts/search-probe.mjs match
//   APP_URL=http://127.0.0.1:8571/ HIT="Try two ways" node scripts/search-probe.mjs match   (a read-only off-branch hit)
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.APP_URL ?? "http://127.0.0.1:8571/";
const mode = process.argv[2] ?? "hits";
const query = process.env.QUERY ?? "deploy";
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const profile = await mkdtemp(join(tmpdir(), "search-probe-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
const facts = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vw = innerWidth, vh = innerHeight;
  const outside = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); };
  const style = (el) => el ? (({ color, backgroundColor, fontSize, fontWeight }) => ({ color, backgroundColor, fontSize, fontWeight }))(getComputedStyle(el)) : null;
  const room = document.querySelector(".picker-room");
  const rows = [...document.querySelectorAll(".hit-row")];
  const roomBox = room?.getBoundingClientRect();
  const visible = rows.filter((row) => { const r = row.getBoundingClientRect(); return roomBox && r.top >= roomBox.top - 1 && r.bottom <= roomBox.bottom + 1; }).length;
  const passage = rows[0]?.querySelector(".hit-row-passage");
  const lineHeight = passage ? parseFloat(getComputedStyle(passage).lineHeight) : 0;
  const bar = document.querySelector('[aria-label="Search matches"]');
  const marked = document.querySelector(".message[data-marked]");
  const viewport = document.querySelector(".transcript");
  const composer = document.querySelector(".composer");
  return {
    viewport: vw + "x" + vh, layout: document.querySelector(".app-shell")?.dataset.layout, sheet: document.querySelector(".app-shell")?.dataset.sheet,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    picker: box(document.querySelector(".picker")), search: box(document.querySelector(".search-field-box")), room: box(room),
    focused: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.className ?? null,
    query: document.querySelector('input[aria-label="Search sessions"]')?.value,
    hits: rows.length, hitsFullyVisible: visible, firstHit: box(rows[0]), passageLines: passage && lineHeight ? Math.round(passage.getBoundingClientRect().height / lineHeight) : null,
    hitText: rows.slice(0, 2).map((row) => row.innerText.replace(/\\n+/g, " | ")),
    mark: style(document.querySelector(".hit-row-mark")), passageStyle: style(passage), title: style(rows[0]?.querySelector(".hit-row-title")),
    tags: [...document.querySelectorAll(".hit-row-tag")].map((tag) => tag.textContent),
    // Every hit's first mark must sit inside its clamped passage.
    hiddenMarks: rows.filter((row) => { const p = row.querySelector(".hit-row-passage"); const m = row.querySelector(".hit-row-mark");
      if (!p || !m) return true; const pr = p.getBoundingClientRect(), mr = m.getBoundingClientRect(); return mr.top < pr.top - 0.5 || mr.bottom > pr.bottom + 0.5; })
      .map((row) => row.querySelector(".hit-row-title")?.textContent),
    focusRing: (() => { const input = document.querySelector(".search-field-input"); const box = document.querySelector(".search-field-box");
      return input && box ? { focused: document.activeElement === input, input: getComputedStyle(input).outlineStyle, box: getComputedStyle(box).outlineStyle + " " + getComputedStyle(box).outlineColor } : null; })(),
    clipped: [...document.querySelectorAll(".picker button, .picker input, .find-bar button, .composer button")].filter(outside).map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()),
    overflowingText: [...document.querySelectorAll(".hit-row-meta, .hit-row-passage, .find-bar-text, .search-field-box")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
    bar: box(bar), barText: bar?.innerText.replace(/\\n+/g, " | "), barStyle: style(bar), composer: box(composer),
    marked: box(marked), markedText: marked?.innerText.slice(0, 60), transcript: box(viewport),
    markedInView: !!(marked && viewport && marked.getBoundingClientRect().top >= viewport.getBoundingClientRect().top && marked.getBoundingClientRect().top < (bar ?? composer ?? viewport).getBoundingClientRect().top),
    tree: (() => { const dialog = document.querySelector("dialog.tree-dialog[open]"); if (!dialog) return null;
      const button = (name) => [...dialog.querySelectorAll("button")].find((node) => node.textContent?.trim() === name);
      return { selected: dialog.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent?.slice(0, 50), lens: dialog.querySelector('[aria-pressed="true"]')?.textContent,
        continueDisabled: button("Continue from here")?.disabled, forkDisabled: button("Fork")?.disabled, sheet: box(dialog.querySelector(".tree-sheet")) }; })(),
    barOverlapsComposer: !!(bar && composer && bar.getBoundingClientRect().bottom > composer.getBoundingClientRect().top + 0.5),
  };
})()`;
try {
  await waitForDebugger(port);
  for (const colorScheme of schemes) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme });
      const loaded = cdp.waitForEvent("Page.loadEventFired", 20_000).catch(() => undefined);
      await cdp.send("Page.navigate", { url: base });
      await loaded;
      await sleep(1500);
      await pressCombo(cdp, "ctrl+k");
      await sleep(300);
      await cdp.send("Input.insertText", { text: query });
      await sleep(1200);
      if (mode === "match") {
        // HIT names the hit to open by the start of its title; the first hit otherwise.
        await evaluate(cdp, `[...document.querySelectorAll(".hit-row")].find((row) => row.querySelector(".hit-row-title")?.textContent?.startsWith(${JSON.stringify(process.env.HIT ?? "")}))?.click()`);
        await sleep(2500);
      }
      console.log(JSON.stringify({ scheme: colorScheme, posture: posture.name, ...(await evaluate(cdp, facts)) }));
      cdp.close();
    }
  }
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}
