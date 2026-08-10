/**
 * Ways to tell a question from an answer while skimming.
 *
 * The rounds behind these:
 *
 * 1. Which cue identifies the speaker? Exposed a worse problem -- the
 *    transcript spent its contrast backwards, muting the reply, which is the
 *    thing actually read.
 * 2. Mute the question instead. Also wrong: prose you may re-read got harder to
 *    read.
 * 3. Stop tinting prose at all. Tone goes back to telling language from
 *    machinery; every written word is full ink. Voice alone turned out not to
 *    be distinct enough.
 * 4. Change the shape of the page rather than the shape of the letters.
 *
 * Tokens are the real Forgerie Dark and Forgerie Light values from
 * src/client/src/plugins/themes/index.ts, not approximations. Both themes are
 * emitted because the band inverts direction between them: the dark surface is
 * lighter than its background, and the light surface is lighter still than
 * its own.
 *
 * Run through ./make-mockups.sh.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const THEMES = {
  dark: { bg: "#070912", surface: "#101527", ink: "#f7f4ff", dim: "#817a99", accent: "#7c3cff", rule: "#26304f" },
  light: { bg: "#f7f1e6", surface: "#fff9ee", ink: "#15131b", dim: "#766f7e", accent: "#6430d8", rule: "#c9bca8" },
};

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif";

const WIDTH = 739;
const COLUMN = 512;
const LEFT = Math.round((WIDTH - COLUMN) / 2);
const PARA_GAP = 16;
const TURN_GAP = 34;

/** The same conversation in every variant. Pre-wrapped: SVG will not wrap text. */
const script = [
  { who: "user", lines: ["Pool all activity in a turn, keeping it adjacent to the", "seconds line at the bottom"] },
  { who: "agent", lines: ["Three separate causes, and only one of them is spacing."] },
  { who: "agent", lines: ["The label is the loudest thing in the transcript. Body prose is", "regular weight; the marker is bold, uppercase and tracked out."] },
  { who: "agent", lines: ["Pooling gives up strict chronology inside a turn. Order still", "survives inside the fold."] },
  { who: "fold", lines: ["27 steps"] },
  { who: "user", lines: ["The agent text is what I want to read deeply, and it is the", "part that looks greyed out."] },
  { who: "agent", lines: ["Contrast was doing identity work. Freed from that, it can mark", "what is worth reading instead."] },
  { who: "agent", lines: ["Here is the same conversation with the hierarchy the right way up."] },
  { who: "fold", lines: ["7 steps"] },
  { who: "live", lines: ["11s \u00b7 read chatGroups.ts"] },
];

const escape = (value) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

const AGENT_SIZE = 15;
const AGENT_LINE = 24;

function textLines(lines, y, T, { anchor = "start" } = {}) {
  const x = anchor === "end" ? LEFT + COLUMN : LEFT;
  return lines
    .map((line, index) => `<text x="${String(x)}" y="${String(y + AGENT_SIZE + index * AGENT_LINE)}" text-anchor="${anchor}" font-family="${SANS}" font-size="${String(AGENT_SIZE)}" fill="${T.ink}">${escape(line)}</text>`)
    .join("\n");
}

/** Blocks no variant changes: the pooled fold and the liveness line. */
function commonBlock(block, y, T) {
  if (block.who === "fold") {
    return {
      height: 22,
      markup: `<text x="${String(LEFT)}" y="${String(y + 15)}" font-family="${SANS}" font-size="13" fill="${T.dim}">\u25b8  ${escape(block.lines[0])}</text>`,
    };
  }
  if (block.who === "live") {
    return {
      height: 22,
      markup: [
        `<circle cx="${String(LEFT + 4)}" cy="${String(y + 10)}" r="3.5" fill="${T.accent}"/>`,
        `<text x="${String(LEFT + 16)}" y="${String(y + 15)}" font-family="${SANS}" font-size="13" fill="${T.dim}">${escape(block.lines[0])}</text>`,
      ].join("\n"),
    };
  }
  return undefined;
}

/** Every variant differs only in how it draws the question. */
function makeVariant({ id, title, drawUser }) {
  return {
    id,
    title,
    draw(block, y, T) {
      const common = commonBlock(block, y, T);
      if (common !== undefined) return common;
      if (block.who === "user") return drawUser(block, y, T);
      return { height: block.lines.length * AGENT_LINE, markup: textLines(block.lines, y, T) };
    },
  };
}

const band = (y, height, T) => `<rect x="0" y="${String(y)}" width="${String(WIDTH)}" height="${String(height)}" fill="${T.surface}"/>`;
const BAND_PAD = 18;

const variants = [
  /* The canvas changes behind the question, full bleed. The words stay ink. */
  makeVariant({
    id: "g1-banded",
    title: "G1 \u2014 banded question",
    drawUser: (block, y, T) => {
      const height = block.lines.length * AGENT_LINE + BAND_PAD * 2;
      return { height, markup: [band(y, height, T), textLines(block.lines, y + BAND_PAD, T)].join("\n") };
    },
  }),

  /* The question sits on the other edge. Asymmetry reads before letters do. */
  makeVariant({
    id: "g3-right-aligned",
    title: "G3 \u2014 right-aligned question",
    drawUser: (block, y, T) => ({
      height: block.lines.length * AGENT_LINE,
      markup: textLines(block.lines, y, T, { anchor: "end" }),
    }),
  }),

  /* Both at once: does the band make the alignment legible, or fight it? */
  makeVariant({
    id: "g1g3-banded-right",
    title: "G1+G3 \u2014 banded and right-aligned",
    drawUser: (block, y, T) => {
      const height = block.lines.length * AGENT_LINE + BAND_PAD * 2;
      return { height, markup: [band(y, height, T), textLines(block.lines, y + BAND_PAD, T, { anchor: "end" })].join("\n") };
    },
  }),
];

function render(variant, T) {
  const body = [];
  let y = 40;
  let previous;

  for (const block of script) {
    if (previous !== undefined) {
      const boundary = block.who === "user" && previous !== "user";
      y += boundary ? TURN_GAP : PARA_GAP;
      if (previous === "fold" && block.who === "live") y -= 10;
    }
    const drawn = variant.draw(block, y, T);
    body.push(drawn.markup);
    y += drawn.height;
    previous = block.who;
  }

  const height = y + 40;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(height)}" viewBox="0 0 ${String(WIDTH)} ${String(height)}">`,
    `<title>${escape(variant.title)}</title>`,
    `<rect width="${String(WIDTH)}" height="${String(height)}" fill="${T.bg}"/>`,
    ...body,
    "</svg>",
  ].join("\n");
}

mkdirSync(OUT, { recursive: true });
for (const variant of variants) {
  for (const [name, T] of Object.entries(THEMES)) {
    const path = join(OUT, `${variant.id}-${name}.svg`);
    writeFileSync(path, render(variant, T));
    console.log(`wrote ${path}`);
  }
}
