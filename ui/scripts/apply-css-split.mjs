#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// One-off: apply the output of `split-css.mjs --write <dir>` to src/.
//   1. Delete the old stylesheets and their imports.
//   2. Copy every split stylesheet into src/.
//   3. Import each component's own stylesheet from that component.
//   4. main.tsx imports the fonts, tokens.css, base.css and the theme.css remainder, in that order.
// Usage: scripts/apply-css-split.mjs /tmp/split-out
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: apply-css-split.mjs <split dir>");
const src = new URL("../src", import.meta.url).pathname;
const OLD = ["ui/backlog/backlog.css", "ui/pullRequest.css", "ui/modelMenu.css", "ui/settings/settings.css", "ui/settings/models.css", "ui/settings/plugins.css", "ui/markdown/richBlocks.css"];

// 1. Old stylesheets out, and every import of them.
const importLine = /^import "\.{1,2}\/[^"]*\.css";\n/gm;
const owned = JSON.parse(readFileSync(join(dir, "owned.json"), "utf8"));
const touched = new Set([...owned.map((css) => css.replace(/\.css$/, ".tsx")), "ui/backlog/BacklogCarry.tsx", "ui/backlog/BacklogView.tsx",
  "ui/markdown/RichBlocks.tsx", "ui/ModelPicker.tsx", "ui/PullNoticeRow.tsx", "ui/PullRequestReview.tsx", "ui/settings/ModelsView.tsx",
  "ui/settings/PluginsView.tsx", "ui/settings/SettingsView.tsx"]);
for (const tsx of touched) {
  const path = join(src, tsx);
  if (!existsSync(path)) throw new Error(`${tsx} does not exist`);
  writeFileSync(path, readFileSync(path, "utf8").replace(importLine, ""));
}
for (const file of OLD) rmSync(join(src, file));

// 2. New stylesheets in.
for (const file of [...owned, "ui/tokens.css", "ui/base.css", "ui/theme.css"]) copyFileSync(join(dir, file), join(src, file));

// 3. Each component imports its own stylesheet, after its last import.
for (const css of owned) {
  const path = join(src, css.replace(/\.css$/, ".tsx"));
  const text = readFileSync(path, "utf8");
  const imports = [...text.matchAll(/^import [^;]+;\n/gm)];
  const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
  writeFileSync(path, `${text.slice(0, at)}import "./${basename(css)}";\n${text.slice(at)}`);
}

// 4. The entry loads global CSS only, fonts first.
const main = join(src, "main.tsx");
const fonts = 'import "@fontsource-variable/public-sans/wght.css";\nimport "@fontsource-variable/jetbrains-mono/wght.css";\n';
const globals = 'import "./ui/tokens.css";\nimport "./ui/base.css";\n// The styles that several components still share. Each moves to its system component (ui/docs/decomposition.md).\nimport "./ui/theme.css";\n';
writeFileSync(main, readFileSync(main, "utf8").replace('import "./ui/theme.css";\n', `${fonts}${globals}`));
console.log(`applied: ${owned.length} component stylesheets, ${OLD.length} old stylesheets removed`);
