#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// One-off tool for the CSS split (ui/docs/decomposition.md, "Tokens and CSS").
// Reads every stylesheet under src/, and decides where each rule goes:
//   - :root custom properties and their dark-scheme overrides -> src/ui/tokens.css
//   - rules on bare elements only                              -> src/ui/base.css
//   - rules whose classes one component renders                -> <Component>.css beside it
//   - rules on classes several components render                -> "shared" (needs a system component)
//   - rules on classes no component renders (third-party DOM)   -> the owner named in THIRD_PARTY
// Usage: scripts/split-css.mjs --report   prints the plan; nothing is written.
// It needs /tmp/css-owners.json: run `CSS_OWNERS=1 npx vitest run gates/css-owners.test.ts` first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import postcss from "postcss";

const ui = new URL("..", import.meta.url).pathname;
const src = join(ui, "src");
const owners = JSON.parse(readFileSync("/tmp/css-owners.json", "utf8"));

/** Classes that a library renders, not a component. Each belongs to the component that mounts the library. */
const THIRD_PARTY = [
  [/^cm-diff|^cm-gutter|^cm-cursor|^cm-selection/, "ui/DiffEditor.tsx"],
  [/^cm-|^tok-/, "ui/ComposerEditor.tsx"],
  [/^hljs-/, "ui/MarkdownText.tsx"],
];

/** Every class rendered by components, merged across stylesheets: class -> unique components. */
const renderers = new Map();
for (const classes of Object.values(owners)) {
  for (const [name, files] of Object.entries(classes)) renderers.set(name, [...new Set([...(renderers.get(name) ?? []), ...files])]);
}

function ownerOf(name) {
  const files = renderers.get(name) ?? [];
  if (files.length) return files;
  const entry = THIRD_PARTY.find(([pattern]) => pattern.test(name));
  return entry ? [entry[1]] : [];
}

/**
 * Decide one selector's destination. A selector belongs to the component that renders its subject,
 * the last compound. `.message-actions .icon-button` styles an icon button from outside: the
 * subject is shared, so it is reported as a reach-in that the kit must replace with a custom property.
 */
function destination(selector) {
  if (selector.trim() === ":root") return { kind: "tokens" };
  // `[data-tone="failed"] { --pr-tone: … }` maps a state to a colour for every component that marks a pull request.
  if (/^\[data-tone="[a-z]+"\]$/.test(selector.trim())) return { kind: "tokens" };
  if (selector.includes("[data-composer-input]")) return { kind: "owned", owner: "ui/ComposerEditor.tsx", unknown: [] };
  const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  if (!classes.length) return { kind: "base" };
  const sets = classes.map(ownerOf);
  const unknown = classes.filter((_, index) => !sets[index].length);
  const union = [...new Set(sets.flat())];
  if (union.length === 1) return { kind: "owned", owner: union[0], unknown };
  const compounds = selector.trim().split(/\s*[\s>+~]\s*/);
  const subject = [...compounds.at(-1).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  const subjectOwners = [...new Set(subject.flatMap(ownerOf))];
  // `.icon-button.changes-opener`: the subject names an owned class, so its owner holds the rule.
  const subjectSingles = [...new Set(subject.map(ownerOf).filter((set) => set.length === 1).flat())];
  if (subjectSingles.length === 1) return { kind: "owned", owner: subjectSingles[0], unknown, via: "subject" };
  // The subject is shared or absent, and an ancestor names one owner: a reach-in from that owner.
  const singles = [...new Set(sets.filter((set) => set.length === 1).flat())];
  if (subjectOwners.length > 1 && singles.length === 1) return { kind: "reach-in", owner: singles[0], unknown, subject };
  if (!subject.length && singles.length === 1) return { kind: "owned", owner: singles[0], unknown, via: "ancestor" };
  return { kind: "shared", owners: union, unknown, classes };
}

// Load order today: main.tsx imports theme.css first; component stylesheets load after it.
const sheets = Object.keys(owners).sort((a, b) => (a === "ui/theme.css" ? -1 : b === "ui/theme.css" ? 1 : a.localeCompare(b))).map((file) => join(src, file));
const plan = [];
for (const sheet of sheets) {
  const root = postcss.parse(readFileSync(sheet, "utf8"), { from: sheet });
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const atRules = [];
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) if (parent.type === "atrule") atRules.unshift(`@${parent.name} ${parent.params}`);
    for (const selector of rule.selectors) {
      plan.push({ sheet: relative(src, sheet), line: rule.source.start.line, selector: selector.replace(/\s+/g, " "), atRules, ...destination(selector) });
    }
  });
}

/**
 * A class is entangled when a selector names it with a class of another owner, or several components
 * render it. Every rule that names an entangled class stays in theme.css until the shared component
 * that owns it exists: moving the rule into one file would put another component's class there.
 */
function entangledClasses() {
  const ownerKey = (name) => ownerOf(name).join("|") || "?";
  const neighbours = new Map();
  const stuck = new Set();
  for (const entry of plan) {
    if (entry.kind === "tokens" || entry.kind === "base") continue;
    const classes = [...entry.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    for (const a of classes) for (const b of classes) if (a !== b) neighbours.set(a, new Set([...(neighbours.get(a) ?? []), b]));
    const keys = new Set(classes.map(ownerKey));
    if (keys.size > 1 || classes.some((name) => ownerOf(name).length > 1)) for (const name of classes) stuck.add(name);
  }
  const queue = [...stuck];
  while (queue.length) for (const next of neighbours.get(queue.pop()) ?? []) if (!stuck.has(next)) { stuck.add(next); queue.push(next); }
  return stuck;
}

if (process.argv.includes("--entangled")) {
  const stuck = entangledClasses();
  const stuckSelectors = plan.filter((entry) => [...entry.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => stuck.has(m[1])));
  console.log(`${stuck.size} entangled classes; ${stuckSelectors.length} of ${plan.length} selectors would stay in theme.css`);
}

const writeAt = process.argv.indexOf("--write");
if (writeAt > 0) writeSplit(process.argv[writeAt + 1]);

/** The file each destination writes, relative to src/. */
function outputFile(entry, selector, stuck) {
  if (entry.kind === "tokens") return "ui/tokens.css";
  if (entry.kind === "base") return "ui/base.css";
  if ([...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => stuck.has(m[1]))) return "ui/theme.css";
  if (entry.kind === "owned" || entry.kind === "reach-in") return entry.owner.replace(/\.tsx$/, ".css");
  return "ui/theme.css";
}

/**
 * Write every output stylesheet under <dir>, mirroring src/. Rules keep their declarations, their
 * comments and their @media or @container wrappers, in their original order within each file.
 * A rule whose selectors go to different files is cloned once per file with its share of selectors.
 */
function writeSplit(dir) {
  const stuck = entangledClasses();
  const outputs = new Map();
  const rootFor = (file) => {
    if (!outputs.has(file)) outputs.set(file, { root: postcss.root(), last: null });
    return outputs.get(file);
  };
  const keyframes = new Map();
  const animationUsers = new Map();

  for (const sheet of sheets) {
    const root = postcss.parse(readFileSync(sheet, "utf8"), { from: sheet });
    let comments = [];
    const place = (node, wrappers) => {
      if (node.type === "comment") { comments.push(node); return; }
      if (node.type === "atrule" && node.name === "import") return; // fonts move to main.tsx
      if (node.type === "atrule" && /keyframes$/.test(node.name)) { keyframes.set(node.params, { node, comments }); comments = []; return; }
      if (node.type === "atrule" && node.nodes) { for (const child of node.nodes) place(child, [...wrappers, node]); return; }
      if (node.type !== "rule") throw new Error(`${sheet}: unexpected ${node.type} ${node.name ?? ""}`);
      const groups = new Map();
      for (const selector of node.selectors) {
        const inRootTokens = wrappers.some((w) => w.params.includes("prefers-color-scheme")) && selector.trim() === ":root";
        const file = inRootTokens ? "ui/tokens.css" : outputFile(destination(selector), selector, stuck);
        groups.set(file, [...(groups.get(file) ?? []), selector]);
      }
      let first = true;
      for (const [file, selectors] of groups) {
        const output = rootFor(file);
        const clone = node.clone({ selectors });
        clone.raws.before = "\n";
        for (const decl of clone.nodes ?? []) {
          if (decl.type === "decl" && /^animation(-name)?$/.test(decl.prop)) {
            for (const name of decl.value.split(/[\s,]+/)) animationUsers.set(name, new Set([...(animationUsers.get(name) ?? []), file]));
          }
        }
        const chainKey = wrappers.map((w) => `@${w.name} ${w.params}`).join(" ");
        let parent = output.root;
        if (wrappers.length) {
          if (output.last?.key === chainKey) parent = output.last.inner;
          else {
            let outer = null, inner = null;
            for (const wrapper of wrappers) {
              const shell = wrapper.clone({ nodes: [] });
              shell.raws.before = "\n";
              if (inner) inner.append(shell); else outer = shell;
              inner = shell;
            }
            output.root.append(outer);
            parent = inner;
          }
        }
        if (first) for (const comment of comments) { const c = comment.clone(); c.raws.before = "\n"; parent.append(c); }
        parent.append(clone);
        output.last = { key: chainKey, inner: parent === output.root ? null : parent };
        if (!wrappers.length) output.last = null;
        first = false;
      }
      comments = [];
    };
    for (const node of root.nodes) place(node, []);
  }

  for (const [name, { node, comments }] of keyframes) {
    const users = [...(animationUsers.get(name) ?? [])];
    const file = users.length === 1 ? users[0] : "ui/theme.css";
    const output = rootFor(file);
    for (const comment of comments) { const c = comment.clone(); c.raws.before = "\n"; output.root.append(c); }
    const clone = node.clone(); clone.raws.before = "\n";
    output.root.append(clone);
  }

  for (const [file, { root }] of outputs) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${root.toString().trim()}\n`);
  }
  const owned = [...outputs.keys()].filter((file) => !["ui/tokens.css", "ui/base.css", "ui/theme.css"].includes(file));
  writeFileSync(join(dir, "owned.json"), `${JSON.stringify(owned.sort(), null, 1)}\n`);
  console.log(`wrote ${outputs.size} stylesheets to ${dir}; keyframes: ${[...keyframes.keys()].map((k) => `${k} -> ${[...(animationUsers.get(k) ?? [])].join("|") || "unused"}`).join(", ")}`);
}


if (process.argv.includes("--report")) {
  const count = (kind) => plan.filter((entry) => entry.kind === kind).length;
  console.log(`${plan.length} selectors: tokens ${count("tokens")}, base ${count("base")}, owned ${count("owned")}, reach-in ${count("reach-in")}, shared ${count("shared")}`);
  const byOwner = new Map();
  for (const entry of plan.filter((e) => e.kind === "owned")) byOwner.set(entry.owner, (byOwner.get(entry.owner) ?? 0) + 1);
  console.log("owned rules per component:", [...byOwner].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f.replace(/^ui\//, "")}:${n}`).join("  "));
  console.log("\nbase rules:");
  for (const entry of plan.filter((e) => e.kind === "base")) console.log(`  ${entry.sheet}:${entry.line} ${entry.atRules.join(" ")} ${entry.selector}`);
  console.log("\nowned rules with a class nothing renders:");
  for (const entry of plan.filter((e) => e.kind === "owned" && e.unknown.length)) console.log(`  ${entry.sheet}:${entry.line} -> ${entry.owner}: ${entry.unknown.join(" ")}`);
  console.log("\nreach-ins (a component restyles a shared class from outside):");
  for (const entry of plan.filter((e) => e.kind === "reach-in")) console.log(`  ${entry.sheet}:${entry.line} ${entry.selector} -> ${entry.owner}`);
  console.log("\nshared selectors by subject class:");
  const bySubject = new Map();
  for (const entry of plan.filter((e) => e.kind === "shared")) {
    const key = entry.classes.at(-1);
    bySubject.set(key, [...(bySubject.get(key) ?? []), entry]);
  }
  for (const [name, entries] of [...bySubject].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  .${name} (${entries.length}) <- ${entries[0].owners.map((f) => f.replace(/^ui\//, "")).join(", ")}`);
  }
}
