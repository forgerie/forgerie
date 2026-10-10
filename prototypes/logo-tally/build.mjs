#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// Writes the three tally-mark logo candidates (light and dark) and a
// contact sheet that shows each one at icon and favicon sizes.
//
// Geometry comes from ui/src/ui/TallyRow.css: a mark is 7 units square
// (0.4375rem), the gap is 3 units (0.1875rem), the corner radius is a
// quarter of the mark, and a row holds three marks.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MARK = 7, GAP = 3, PITCH = MARK + GAP, R = MARK / 4;

// Tones are the app's tally tones converted from oklch (theme.css).
const palettes = {
  light: { paper: "#faf7f0", ink: "#232323", bad: "#de3b3d", live: "#2b7fff", faint: "#9a978f" },
  dark: { paper: "#111214", ink: "#ececea", bad: "#ff645f", live: "#4c93ff", faint: "#6a6966" },
};

const mark = (x, y, fill, extra = "") =>
  `<rect x="${x}" y="${y}" width="${MARK}" height="${MARK}" rx="${R}" fill="${fill}"${extra}/>`;
const cell = (col, row, fill, extra) => mark(col * PITCH, row * PITCH, fill, extra);

/**
 * A glyph drawn from rows of text: `#` is a plain mark, `r` a failed mark,
 * `b` a live mark, and `.` an empty cell. The box and the maskable scale
 * follow from the pattern: the box's diagonal fits inside the safe circle.
 */
const grid = (name, note, rows) => {
  const tones = { "#": "ink", r: "bad", b: "live" };
  const w = Math.max(...rows.map((r) => r.length)) * PITCH - GAP, h = rows.length * PITCH - GAP;
  return {
    name, note, box: [w, h], scale: Math.floor(780 / Math.hypot(w, h)), nudge: [0, 0],
    glyph: (p) => rows.flatMap((r, y) => [...r].map((ch, x) => tones[ch] ? cell(x, y, p[tones[ch]]) : "")).join(""),
  };
};

/**
 * Each candidate returns its glyph in tally units plus its box, so one
 * wrapper can centre it inside the maskable safe zone (the inner 80% circle).
 */
const candidates = {
  "run": grid("The run (reference)",
    "The previous pick: eight calls, wrapped and right-aligned as the chat draws them.",
    ["###", "r##", ".#b"]),
  "run-f5": grid("Run F",
    "Eight marks, the same count as the run, on its three-wide grid. Red sits where it sat in the run; the live mark ends the middle arm.",
    ["###", "r..", "#b.", "#..", "#.."]),
  "run-f5-tips": grid("Run F, coloured tips",
    "The same eight marks. Red ends the top arm, as the falling piece does in the current mark, and the spine stays one colour.",
    ["##r", "#..", "#b.", "#..", "#.."]),
  "run-f4-tips": grid("Run F, short",
    "Seven marks in four rows, with coloured tips. Fewer rows make bigger marks at every icon size.",
    ["##r", "#..", "#b.", "#.."]),
};

// The maskable icon keeps the glyph inside the safe zone. The tab icon
// needs no safe zone, so its glyph fills most of the square.
const svg = (id, c, scheme, tab = false) => {
  const p = palettes[scheme];
  const [w, h] = c.box, [nx, ny] = c.nudge;
  const scale = tab ? 880 / Math.max(w, h + 2 * ny) : c.scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Forgerie mark: ${c.name}">
  <rect width="1024" height="1024" fill="${p.paper}"/>
  <g transform="translate(512 512) scale(${scale}) translate(${-w / 2 + nx} ${-h / 2 + ny})">${c.glyph(p)}</g>
</svg>
`;
};

const out = join(here, "marks");
mkdirSync(out, { recursive: true });
for (const [id, c] of Object.entries(candidates))
  for (const scheme of Object.keys(palettes))
    for (const tab of [false, true])
      writeFileSync(join(out, `${id}-${scheme}${tab ? "-tab" : ""}.svg`), svg(id, c, scheme, tab));

// Contact sheet: the current mark first, then each candidate at 256, 64,
// 32 and 16 px, light and dark, plus a circle crop for maskable launchers.
// The 32 and 16 px sizes and the browser tab use the tab icon.
const sizes = [64, 32, 16];
const row = (label, note, file, tabFile = file) => `
  <section>
    <h2>${label}</h2><p>${note}</p>
    <div class="tiles">
      ${["light", "dark"].map((s) => {
        const src = file(s), tab = tabFile(s);
        return `<div class="scheme ${s}">
          <img src="${src}" width="256" height="256" alt="">
          <img class="round" src="${src}" width="128" height="128" alt="">
          <div class="small">${sizes.map((z) => `<img src="${z > 32 ? src : tab}" width="${z}" height="${z}" alt="">`).join("")}</div>
          <div class="tab"><img src="${tab}" width="16" height="16" alt=""><span>Forgerie</span></div>
        </div>`;
      }).join("")}
    </div>
  </section>`;

writeFileSync(join(here, "sheet.html"), `<!doctype html>
<meta charset="utf-8"><title>Tally logo candidates</title>
<style>
  body { margin: 0; padding: 32px; font: 15px/1.4 system-ui, sans-serif; background: #e9e7e2; color: #222; }
  section { margin-block-end: 36px; }
  h2 { margin: 0 0 2px; font-size: 18px; }
  p { margin: 0 0 12px; max-width: 70ch; color: #555; }
  .tiles { display: flex; gap: 20px; }
  .scheme { display: flex; align-items: center; gap: 20px; padding: 16px; border-radius: 12px; }
  .scheme.light { background: #ffffff; }
  .scheme.dark { background: #2a2b2e; color: #ddd; }
  .round { border-radius: 50%; }
  .small { display: flex; align-items: end; gap: 12px; }
  .tab { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px 8px 0 0; font-size: 12px; background: rgba(127,127,127,.18); }
</style>
${row("Current: block F", "The shipped mark, for comparison.", (s) => s === "light" ? "../../ui/public/favicon.svg" : "../../ui/public/favicon.svg")}
${Object.entries(candidates).map(([id, c]) => row(c.name, c.note, (s) => `marks/${id}-${s}.svg`, (s) => `marks/${id}-${s}-tab.svg`)).join("")}
`);
console.log("wrote", out, "and sheet.html");
