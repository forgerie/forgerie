#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// Prove that every gate bites (caliper-parts: "a gate that has never failed is a guess").
// Plant one defect per gate, run the gates, and list each gate that still passes. Then remove the plants.
// Usage: gates/prove-bite.mjs   (from ui/). Exit 1 if any gate passed with its defect planted.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ui = new URL("..", import.meta.url).pathname;
const plants = {
  // part without component; part does not render its component; a part in a layer that has none yet
  // ("layer without parts" bites when its list changes, so this must name a layer still missing from pending.json)
  "src/ui/Ghost.template.part.tsx": `import { CopyButton } from "./CopyButton";\nexport default function Ghost() { return <CopyButton label="x" getText={() => ""} />; }\n`,
  // a component with: no consumer, a domain noun, product copy, raw px, raw colour in style, inline style, state read, second component
  "src/ui/SessionPlant.tsx": `import { useContext, createContext } from "react";\nconst C = createContext(0);\nexport function SessionPlant() { useContext(C); return <p style={{ color: "#ff0000", width: "12px" }}>Plant this sentence here</p>; }\nexport function SecondPlant() { return null; }\n`,
  // part without layer, computed metadata, randomness, state read, no default function, renders nothing
  "src/ui/SessionPlant.part.tsx": `import { SessionPlant } from "./SessionPlant";\nexport const name = String("plant");\nexport const Random = () => { Math.random(); fetch("/x"); return null; };\nexport const Plain = () => <SessionPlant />;\n`,
  // an atom that imports a molecule; a stylesheet whose class the owner does not render; shared space imports a feature
  "src/ui/PlantAtom.tsx": `import "./PlantAtom.css";\nimport { CopyButton } from "./CopyButton";\nimport { Thing } from "../plantfeature/Thing.binding";\nexport function PlantAtom() { return <span className="plant-atom"><CopyButton label="x" getText={() => ""} /><Thing /></span>; }\n`,
  "src/ui/PlantAtom.atom.part.tsx": `import { PlantAtom } from "./PlantAtom";\nexport default function Plain() { return <PlantAtom />; }\n`,
  // a raw pixel value, a custom property declared twice, @import, a universal child selector
  "src/ui/PlantAtom.css": `@import "./PlantOrphan.css";\n.plant-atom { color: var(--foreground); width: 12px; --plant: 1; --plant: 2; }\n.plant-atom > * { color: inherit; }\n.plant-foreign { color: var(--foreground); }\n`,
  // a stylesheet nobody owns, defining a class another stylesheet defines
  "src/ui/PlantOrphan.css": `.plant-atom { color: var(--foreground); }\n`,
  // a component without a part, repeating another component's className literal
  "src/ui/NoPart.tsx": `export function NoPart() { return <span className="plant-atom" />; }\n`,
  // a shape that styles its own element and imports a stylesheet
  "src/plantfeature/PlantShape.tsx": `import "./PlantShape.css";\nexport function PlantShape() { return <div className="plant-shape" />; }\n`,
  "src/plantfeature/PlantShape.css": `.plant-shape { color: var(--foreground); }\n`,
  // a chat shape may read the assistant-ui runtime (decision A) but may not style a primitive
  "src/chat/PlantChat.tsx": `import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";\nexport function PlantChat() { useAuiState((s) => s); return <ComposerPrimitive.Root className="plant-chat" />; }\n`,
  // a binding imported below the top; a binding in the shared space
  "src/plantfeature/Thing.binding.tsx": `export function Thing() { return null; }\n`,
  "src/ui/Shared.binding.tsx": `export function Shared() { return null; }\n`,
  // a global stylesheet holding a component class
  "src/ui/base.css": `.plant-global { color: var(--foreground); }\n`,
};

const planted = [];
const createdDirs = [];
// The entry gate needs a stylesheet import in the entry itself. Restored in finally.
const entry = join(ui, "src/main.tsx");
const entryText = readFileSync(entry, "utf8");
try {
  writeFileSync(entry, `${entryText}import "./ui/PlantOrphan.css";\n`);
  for (const [file, text] of Object.entries(plants)) {
    const path = join(ui, file);
    if (existsSync(path)) throw new Error(`${file} exists; refusing to overwrite it.`);
    // Remember each folder this script creates, so cleanup removes only those and never a real feature folder.
    const created = mkdirSync(dirname(path), { recursive: true });
    if (created) createdDirs.push(created);
    writeFileSync(path, text);
    planted.push(path);
  }
  const output = join(tmpdir(), `gates-bite-${process.pid}.json`);
  try {
    execFileSync("npx", ["vitest", "run", "gates", "--reporter=json", `--outputFile=${output}`], { cwd: ui, stdio: "ignore" });
  } catch { /* failing gates are the point */ }
  const report = readFileSync(output, "utf8");
  rmSync(output);
  // Skipped tests are reports, such as css-owners.test.ts, not gates.
  const results = JSON.parse(report).testResults.flatMap((file) => file.assertionResults).filter((test) => test.status !== "skipped" && test.status !== "pending");
  const passed = results.filter((test) => test.status === "passed").map((test) => test.title)
    .filter((title) => !["the app publishes parts", "each part sits in its component's folder"].includes(title));
  console.log(`${results.length - passed.length} of ${results.length} gate tests failed with the defects planted.`);
  if (passed.length) { console.log("Still passing, so not proven:"); for (const title of passed) console.log(`  ${title}`); process.exitCode = 1; }
} finally {
  writeFileSync(entry, entryText);
  for (const path of planted) rmSync(path);
  for (const dir of createdDirs.reverse()) rmSync(dir, { recursive: true, force: true });
}
