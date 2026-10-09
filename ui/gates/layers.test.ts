/**
 * The system / shape / binding gate (atomic-decomp, part two).
 *
 * System components hold reusable decisions and know no domain. Shapes arrange
 * one screen with domain words and stay thin. A binding, one per screen, is the
 * only place below the entry that reads a store, a context, or the network.
 */
import { basename } from "node:path";
import { describe, test } from "vitest";
import ts from "typescript";
import {
  ast, bindingFiles, componentFiles, ENTRY, SRC, expectOnlyPending, importedNames, isBinding, isSystemFile, partFiles, read, rel,
  resolveImport, runtimeImports, runtimeModules, shapeComponents, styledIntrinsics, SYSTEM, systemComponents, cssImports, visit,
} from "./source";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Identifiers that read shared state. React's own hooks for local state (useState, useRef, …) are not here. */
const STATE_READ = /^(useContext|useSyncExternalStore|fetch|localStorage|sessionStorage|EventSource|WebSocket|useExternalStoreRuntime|useExternalMessageConverter)$/;
/**
 * assistant-ui's runtime context: its hooks, its conditional and its primitives.
 *
 * Decision A (2026-10-08, ui/docs/decomposition.md): the chat views in src/chat/
 * keep reading this one context. Their binding builds the runtime from plain
 * data, and each chat part builds the same runtime from fixtures. Everywhere
 * else, including the shared space, it is a state read like any other.
 * Decision B, the follow-up, removes this exception: chat views take plain
 * props (work/items/parking-lot/01M1DZ0000000000000000000B-*.md).
 */
const RUNTIME_READ = /^(useAui|useAuiState|useAuiEvent|AuiIf|unstable_use[A-Za-z]+|[A-Z][A-Za-z]*Primitive)$/;
const CHAT = join(SRC, "chat");
const readsRuntimeByDecision = (file: string) => file.startsWith(`${CHAT}/`) && !isBinding(file);

function stateReads(file: string): string[] {
  const found = new Set<string>();
  visit(ast(file), (node) => {
    if (!ts.isIdentifier(node)) return;
    if (STATE_READ.test(node.text)) found.add(node.text);
    if (RUNTIME_READ.test(node.text) && !readsRuntimeByDecision(file)) found.add(node.text);
  });
  visit(ast(file), (node) => {
    // React 19's use(Context) reads a context too.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "use") found.add("use()");
  });
  // A project hook is a state read unless it is a UI-behaviour hook in the shared space.
  for (const { specifier, names } of importedNames(file)) {
    const target = resolveImport(file, specifier);
    if (!target || isSystemFile(target)) continue;
    for (const name of names) if (/^use[A-Z]/.test(name)) found.add(name);
  }
  return [...found].map((token) => `${rel(file)}: ${token}`);
}

describe("bindings are the only files that read state", () => {
  test("no component reads a store, a context, or the network", () => {
    expectOnlyPending("component reads state", componentFiles.flatMap(stateReads));
  });

  test("no part reads state or fetches", () => {
    expectOnlyPending("part reads state", partFiles.flatMap(stateReads));
  });

  test("only the entry and other bindings import a binding", () => {
    expectOnlyPending("binding imported below the top", runtimeModules.filter((file) => file !== ENTRY && !isBinding(file))
      .flatMap((file) => runtimeImports(file).filter((specifier) => isBinding(resolveImport(file, specifier) ?? ""))
        .map((specifier) => `${rel(file)} -> ${specifier}`)));
  });

  test("bindings live in feature folders", () => {
    expectOnlyPending("binding in the shared space", bindingFiles.filter(isSystemFile).map(rel));
  });
});

describe("shapes stay thin", () => {
  // A shape that styles its own elements holds a layout or look that a system
  // component should own. Plain semantic markup (<p>, <strong>, <code>) is content.
  // Under decision A a chat shape composes assistant-ui primitives for behaviour.
  // The look still comes from a system component: <XPrimitive.Root asChild><Frame/></XPrimitive.Root>.
  test("no shape styles an intrinsic element or imports a stylesheet", () => {
    expectOnlyPending("shape with its own styling", shapeComponents.flatMap((file) => [
      ...new Set(styledIntrinsics(file)), ...cssImports(file).map((sheet) => `imports ${basename(sheet)}`),
    ].map((offence) => `${rel(file)}: ${offence}`)));
  });
});

describe("the shared space knows no domain", () => {
  // Strip the domain nouns: if the name still makes sense, it is a system component.
  const DOMAIN_NOUNS = new Set(["Agent", "Archive", "Ask", "Azure", "Backlog", "Branch", "Changes", "Commit", "Compaction",
    "Destination", "Dictation", "Forgerie", "GitHub", "Handoff", "Land", "Launch", "Mention", "Model", "Note", "Pi", "Plugin",
    "Project", "Prompt", "Pull", "Queue", "Session", "Shell", "Skill", "Slash", "Trace", "Update", "Worktree"]);
  const words = (name: string) => name.match(/[A-Z][a-z0-9]*|[A-Z]+(?![a-z])/g) ?? [];

  test("no system component names a domain concept", () => {
    expectOnlyPending("system component named for the domain", systemComponents.flatMap((file) => {
      const name = basename(file, ".tsx");
      const nouns = words(name).filter((word) => DOMAIN_NOUNS.has(word));
      return nouns.length ? [`${rel(file)}: ${nouns.join(", ")}`] : [];
    }));
  });

  test("the shared space imports nothing from a feature", () => {
    const shared = runtimeModules.filter(isSystemFile);
    expectOnlyPending("shared space imports a feature", shared.flatMap((file) => runtimeImports(file).flatMap((specifier) => {
      const target = resolveImport(file, specifier);
      return target && !target.startsWith(`${SYSTEM}/`) ? [`${rel(file)} -> ${specifier}`] : [];
    })));
  });

  test("every system component is listed in the shared catalogue", () => {
    // Agents reinvent what they cannot find. src/ui/README.md is where they look first.
    let catalogue = "";
    try { catalogue = readFileSync(join(SYSTEM, "README.md"), "utf8"); } catch { /* absent: every component is unlisted */ }
    expectOnlyPending("system component missing from src/ui/README.md", systemComponents
      .filter((file) => !catalogue.includes(`\`${basename(file, ".tsx")}\``)).map(rel));
  });

  test("system component files hold no product-specific copy", () => {
    // Words reach a system component through props. A sentence in it is a domain decision.
    expectOnlyPending("system component with product copy", systemComponents.flatMap((file) =>
      [...read(file).matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+){2,}[^<{]*)</g)].map((match) => `${rel(file)}: "${match[1]!.trim()}"`)));
  });
});
