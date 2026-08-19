import { existsSync } from "node:fs";

const FULL_TEST_TRIGGER_FILES = new Set([
  "package-lock.json",
  "package.json",
  "vitest.config.ts",
]);

const RELATED_SOURCE_DIRECTORIES = [
  "extensions/",
  "pi-web-plugins/",
  "plugin-api/",
  "scripts/",
  "src/",
];

// `vitest related` follows imports. These suites also inspect repository files at runtime.
const DOCKER_TESTS = [
  "src/docker/piWebDockerDocs.test.ts",
  "src/docker/piWebDockerEntrypoint.test.ts",
  "src/server/dockerControlAssets.test.ts",
  "src/server/dockerDevDependencySync.test.ts",
];

const CLIENT_BUILD_TEST = "src/clientBuildContents.test.ts";
const DOCKER_DOCS_TEST = "src/docker/piWebDockerDocs.test.ts";
const DOCS_SITE_TEST = "scripts/docs-site.test.mjs";
const INSTALL_SCRIPT_TEST = "src/installScript.test.ts";
const PLUGIN_PUBLIC_API_TEST = "pi-web-plugins/pluginPublicApi.test.ts";
const SMART_TURN_PROCESS_TEST = "src/server/speech/smartTurnProcess.test.ts";
const WHISPER_PROCESS_TEST = "src/server/speech/whisperProcess.test.ts";

export function parseNullDelimitedPaths(output) {
  const value = Buffer.isBuffer(output) ? output.toString("utf8") : output;
  return value.split("\0").filter((path) => path.length > 0);
}

export function parseNameStatusChanges(output) {
  const fields = parseNullDelimitedPaths(output);
  if (fields.length % 2 !== 0) throw new Error("Git returned an invalid change list");
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return changes;
}

export function createTestPlan(changedPaths, options = {}) {
  const pathExists = options.pathExists ?? existsSync;
  const paths = normalizeRepoPaths(changedPaths);

  if (paths.some(isFullTestTrigger)) return { mode: "full", files: [] };
  if (paths.some((path) => isRelatedSourcePath(path) && !pathExists(path))) {
    return { mode: "full", files: [] };
  }

  const files = relatedTestInputs(paths);
  return files.length > 0 ? { mode: "related", files } : { mode: "skip", files: [] };
}

export function normalizeRepoPaths(paths) {
  return [...new Set(paths.map(normalizeRepoPath).filter((path) => path.length > 0))].sort();
}

export function vitestArgsForTestPlan(plan) {
  if (plan.mode === "full") {
    return ["run", "--config", "vitest.config.ts"];
  }
  if (plan.mode === "related") {
    return [
      "related",
      "--run",
      "--config",
      "vitest.config.ts",
      "--passWithNoTests",
      ...plan.files,
    ];
  }
  return [];
}

function relatedTestInputs(paths) {
  const inputs = new Set();

  for (const path of paths) {
    if (isRelatedSourcePath(path)) inputs.add(path);

    if (path.startsWith("docker/")) {
      addAll(inputs, DOCKER_TESTS);
    } else if (path === "README.md" || path.startsWith("docs/")) {
      inputs.add(DOCKER_DOCS_TEST);
    }

    if (path === "docs/site.js" || path === "docs/styles.css") inputs.add(DOCS_SITE_TEST);
    if (path.startsWith("pi-web-plugins/")) inputs.add(PLUGIN_PUBLIC_API_TEST);
    if (path === "vite.config.ts" || path.startsWith("src/client/public/") || path === "src/client/index.html") {
      inputs.add(CLIENT_BUILD_TEST);
    }
    if (path === "install.sh") inputs.add(INSTALL_SCRIPT_TEST);
    if (path === "nix/smart-turn.nix" || path === "speech/smart_turn_worker.py") {
      inputs.add(SMART_TURN_PROCESS_TEST);
    }
    if (path === "nix/whisper-stt.nix" || path === "speech/whisper_worker.py") {
      inputs.add(WHISPER_PROCESS_TEST);
    }
  }

  return [...inputs].sort();
}

function isFullTestTrigger(path) {
  return FULL_TEST_TRIGGER_FILES.has(path)
    || /^tsconfig(?:\.[^/]+)?\.json$/u.test(path)
    || path.startsWith("vendor/");
}

function isRelatedSourcePath(path) {
  if (path === "plugin-api.d.ts") return true;
  if (!/\.(?:[cm]?[jt]s|[jt]sx|json)$/u.test(path)) return false;
  return RELATED_SOURCE_DIRECTORIES.some((directory) => path.startsWith(directory));
}

function normalizeRepoPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}
