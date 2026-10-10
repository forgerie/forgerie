#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#resvg nixpkgs#imagemagick nixpkgs#oxipng nixpkgs#chromium --command node
// Generates every Forgerie icon from one definition of the mark.
//
// The mark is eight tally marks from the chat margin, on a 3 × 3 grid. The
// five plain marks make an F; the failed (red) and live (blue) marks sit at
// the edge of the block, outside the F. The bottom-left cell is empty.
//
// Two drawings of the same mark:
// - Large: the tally's own geometry (ui/src/ui/TallyRow.css). A mark is 7
//   units, the gap 3, the corner radius a quarter of the mark. Used for app
//   icons, splash screens, and docs.
// - Small: a 16 px grid with 4 px marks and 1 px gaps, so every edge lands
//   on a whole pixel at 16, 32 and 48 px. Used for the tab icon and ICO.
//
// The PNGs, the ICO and the splash links in ui/index.html are generated
// files. Change this script and run it again; do not edit them by hand.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "ui/public");
const brandDir = join(root, "docs/brand");
const work = mkdtempSync(join(tmpdir(), "forgerie-icons-"));

const PATTERN = ["b##", "r##", ".#b"];
const TONES = { "#": "ink", r: "bad", b: "live" };

// The app's page backgrounds (ui/index.html theme-color) and its tally
// tones (theme.css --tone-bad and --tone-live), converted from oklch.
const COLORS = {
  light: { paper: "#fcfcfc", ink: "#232323", bad: "#de3b3d", live: "#2b7fff" },
  dark: { paper: "#101011", ink: "#ececea", bad: "#ff645f", live: "#4c93ff" },
};

const LARGE = { mark: 7, gap: 3, origin: 0 };
const SMALL = { mark: 4, gap: 1, origin: 1 };
const GLYPH = 3 * LARGE.mark + 2 * LARGE.gap; // 27 units

/** The mark's cells as `<rect>` elements. `fill(tone)` returns attributes. */
const cells = ({ mark, gap, origin }, fill) => PATTERN.flatMap((row, y) => [...row].map((ch, x) => {
  const tone = TONES[ch];
  if (!tone) return "";
  const at = (i) => origin + i * (mark + gap);
  return `<rect x="${at(x)}" y="${at(y)}" width="${mark}" height="${mark}" rx="${mark / 4}" ${fill(tone)}/>`;
})).join("");

const colored = (scheme) => (tone) => `fill="${COLORS[scheme][tone]}"`;
const solid = (color) => () => `fill="${color}"`;

/**
 * A large-geometry icon in pixel space: an optional background, then the
 * glyph centred at `glyph` × the shorter side.
 */
const icon = ({ width, height, background = "", glyph, fill, label = "Forgerie" }) => {
  const scale = (Math.min(width, height) * glyph) / GLYPH;
  const x = (width - GLYPH * scale) / 2, y = (height - GLYPH * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
${background}<g transform="translate(${x} ${y}) scale(${scale})">${cells(LARGE, fill)}</g>
</svg>
`;
};
const square = (size, color) => `<rect width="${size}" height="${size}" fill="${color}"/>`;
const tile = (size, color) => `<rect width="${size}" height="${size}" rx="${size * 0.225}" fill="${color}"/>`;

const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path; };
const run = (cmd, args, stderr = "inherit") => execFileSync(cmd, args, { stdio: ["ignore", "ignore", stderr] });
const raster = (svg, out, width, height = width) => {
  const src = write(join(work, `${Math.random().toString(36).slice(2)}.svg`), svg);
  run("resvg", ["--width", String(width), "--height", String(height), src, out]);
  return out;
};

// --- Browser tab ---------------------------------------------------------

// The tab icon follows the system colour scheme. A tile under the marks
// keeps them visible when the browser's own theme differs from the system.
const smallTile = (paper) => `<rect width="16" height="16" rx="3" fill="${paper}"/>`;
const tabIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" role="img" aria-label="Forgerie">
<style>
.p{fill:${COLORS.light.paper}}.ink{fill:${COLORS.light.ink}}.bad{fill:${COLORS.light.bad}}.live{fill:${COLORS.light.live}}
@media (prefers-color-scheme:dark){.p{fill:${COLORS.dark.paper}}.ink{fill:${COLORS.dark.ink}}.bad{fill:${COLORS.dark.bad}}.live{fill:${COLORS.dark.live}}}
</style>
<rect class="p" width="16" height="16" rx="3"/>${cells(SMALL, (tone) => `class="${tone}"`)}
</svg>
`;
write(join(publicDir, "favicon.svg"), tabIcon);

// The ICO cannot follow the scheme, so it uses the dark tile, like the app icon.
const smallDark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${smallTile(COLORS.dark.paper)}${cells(SMALL, colored("dark"))}</svg>`;
const icoLayers = [16, 32, 48].map((size) => raster(smallDark, join(work, `ico-${size}.png`), size));
run("magick", [...icoLayers, join(publicDir, "favicon.ico")]);

// Safari pinned tabs: one colour, no background. Safari fills it itself.
write(join(publicDir, "safari-pinned-tab.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH} ${GLYPH}">${cells(LARGE, solid("#000"))}</svg>\n`);

// --- Installed app -------------------------------------------------------

const dark = COLORS.dark;
const sources = {
  // purpose "any": the icon draws its own rounded tile.
  any: (size) => icon({ width: size, height: size, background: tile(size, dark.paper), glyph: 0.54, fill: colored("dark") }),
  // purpose "maskable": full bleed; the glyph's diagonal fits the 80% safe circle.
  maskable: (size) => icon({ width: size, height: size, background: square(size, dark.paper), glyph: 0.5, fill: colored("dark") }),
  // purpose "monochrome": the system uses only the alpha channel.
  monochrome: (size) => icon({ width: size, height: size, glyph: 0.5, fill: solid("#fff") }),
  // iOS rounds the corners itself and needs an opaque square.
  apple: (size) => icon({ width: size, height: size, background: square(size, dark.paper), glyph: 0.54, fill: colored("dark") }),
};
for (const size of [192, 512]) {
  raster(sources.any(size), join(publicDir, `icon-${size}.png`), size);
  raster(sources.maskable(size), join(publicDir, `icon-maskable-${size}.png`), size);
}
raster(sources.monochrome(512), join(publicDir, "icon-monochrome-512.png"), 512);
raster(sources.apple(180), join(publicDir, "apple-touch-icon.png"), 180);

// iOS launch screens. iOS shows one only when the link's media query names
// the exact device, so there is one per device size and orientation.
// [CSS width, CSS height, pixel ratio], portrait.
const APPLE_DEVICES = [
  [1032, 1376, 2], [1024, 1366, 2], [834, 1210, 2], [834, 1194, 2], [834, 1112, 2],
  [820, 1180, 2], [810, 1080, 2], [768, 1024, 2], [744, 1133, 2],
  [440, 956, 3], [430, 932, 3], [428, 926, 3], [414, 896, 3], [414, 896, 2],
  [414, 736, 3], [402, 874, 3], [393, 852, 3], [390, 844, 3], [375, 812, 3],
  [375, 667, 2], [320, 568, 2],
];
const splashDir = join(publicDir, "splash");
rmSync(splashDir, { recursive: true, force: true });
mkdirSync(splashDir, { recursive: true });
const splashLinks = [];
for (const [w, h, ratio] of APPLE_DEVICES) {
  for (const orientation of ["portrait", "landscape"]) {
    const [pw, ph] = orientation === "portrait" ? [w * ratio, h * ratio] : [h * ratio, w * ratio];
    const name = `apple-splash-${pw}x${ph}.png`;
    raster(icon({ width: pw, height: ph, background: `<rect width="${pw}" height="${ph}" fill="${dark.paper}"/>`, glyph: 0.2, fill: colored("dark") }),
      join(splashDir, name), pw, ph);
    splashLinks.push(`    <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})" href="%BASE_URL%splash/${name}" />`);
  }
}
const indexPath = join(root, "ui/index.html");
const index = readFileSync(indexPath, "utf8");
const block = /( *<!-- apple-splash:start[^\n]*\n)[\s\S]*?( *<!-- apple-splash:end -->)/u;
if (!block.test(index)) throw new Error("ui/index.html has no apple-splash:start/end block");
writeFileSync(indexPath, index.replace(block, (_, start, end) => `${start}${splashLinks.join("\n")}\n${end}`));

// --- Docs and sharing ----------------------------------------------------

const glyphOnly = (scheme) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH} ${GLYPH}" role="img" aria-label="Forgerie">${cells(LARGE, colored(scheme))}</svg>\n`;
write(join(brandDir, "mark-on-light.svg"), glyphOnly("light"));
write(join(brandDir, "mark-on-dark.svg"), glyphOnly("dark"));
write(join(brandDir, "icon.svg"), sources.any(1024));
write(join(brandDir, "icon-maskable.svg"), sources.maskable(1024));

// Social cards are HTML, so the wordmark is set in the app's own face.
const font = pathToFileURL(join(root, "ui/node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2")).href;
const card = (width, height) => `<!doctype html><meta charset="utf-8">
<style>
@font-face { font-family: "Public Sans"; src: url("${font}") format("woff2"); font-weight: 100 900; }
html, body { margin: 0; }
body { inline-size: ${width}px; block-size: ${height}px; display: grid; place-content: center start; padding-inline: 112px; box-sizing: border-box;
  background: ${dark.paper}; color: ${dark.ink}; font-family: "Public Sans"; }
.lockup { display: grid; grid-template-columns: auto 1fr; column-gap: 56px; align-items: center; }
.lockup svg { inline-size: 184px; block-size: 184px; }
h1 { margin: 0; font-size: 128px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
p { grid-column: 2; margin: 28px 0 0; max-inline-size: 22ch; font-size: 38px; line-height: 1.3; color: #a3a3a0; }
</style>
<div class="lockup">${glyphOnly("dark")}<h1>Forgerie</h1>
<p>A browser control surface for persistent Pi coding agent sessions.</p></div>`;
for (const [width, height, name] of [[1200, 630, "social-card-1200x630.png"], [1280, 640, "social-card-1280x640.png"]]) {
  const page = write(join(work, `card-${width}.html`), card(width, height));
  const shot = join(work, `card-${width}.png`);
  run("chromium", ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--allow-file-access-from-files", `--window-size=${width},${height}`, `--screenshot=${shot}`, pathToFileURL(page).href], "ignore");
  // Headless Chromium can add a few rows; keep the exact card size.
  run("magick", [shot, "-crop", `${width}x${height}+0+0`, "+repage", join(brandDir, name)]);
}
// The page's og:image.
run("cp", [join(brandDir, "social-card-1200x630.png"), join(publicDir, "social-card.png")]);

// --- Finish ----------------------------------------------------------------

const pngs = [
  ...readdirSync(publicDir).filter((f) => f.endsWith(".png")).map((f) => join(publicDir, f)),
  ...readdirSync(splashDir).map((f) => join(splashDir, f)),
  ...readdirSync(brandDir).filter((f) => f.endsWith(".png")).map((f) => join(brandDir, f)),
];
run("oxipng", ["--quiet", "-o", "4", "--strip", "safe", ...pngs]);
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${pngs.length} PNGs, favicon.ico, and the SVGs in ui/public and docs/brand.`);
