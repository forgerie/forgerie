#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// One-off report for the token step: every raw colour or pixel value in a stylesheet outside the
// :root token blocks, grouped by value and the property that uses it. Nothing is written.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postcss from "postcss";

const src = new URL("../src", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const RAW = /#[0-9a-fA-F]{3,8}\b|(?<![\w-])\d*\.?\d+px\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\((?:[^()]|\([^()]*\))*\)/g;
const uses = new Map();
for (const sheet of walk(src).filter((file) => file.endsWith(".css"))) {
  postcss.parse(readFileSync(sheet, "utf8")).walkDecls((decl) => {
    if (decl.parent?.selector === ":root") return;
    for (const [value] of decl.value.matchAll(RAW)) {
      const key = `${value}  [${decl.prop}]`;
      const list = uses.get(key) ?? [];
      list.push(`${relative(src, sheet)}:${decl.source.start.line} ${decl.parent.selector?.replace(/\s+/g, " ").slice(0, 60) ?? decl.parent.name}`);
      uses.set(key, list);
    }
  });
}
for (const [key, list] of [...uses].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(3)}  ${key}`);
  if (process.argv.includes("--where")) for (const line of list) console.log(`       ${line}`);
}
