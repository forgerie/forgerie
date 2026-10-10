import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { Check } from "typebox/value";

const schema = Type.Object({ command: Type.String({ minLength: 1 }), args: Type.Array(Type.String()), cwd: Type.String({ minLength: 1 }), env: Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), Type.String()) }, { additionalProperties: false });
const path = process.argv[2];
if (path === undefined) throw new Error("Workspace services launch specification is required");
let specification: unknown;
try { specification = JSON.parse(await readFile(path, "utf8")); }
catch (error) {
  const reason = error instanceof SyntaxError ? "invalid JSON" : errorCode(error);
  // eslint-disable-next-line preserve-caught-error -- JSON error causes can contain private environment values. Expose only a sanitized code.
  throw new Error(`Cannot read the private workspace services launch specification: ${reason}`);
}
if (!Check(schema, specification)) throw new Error("Invalid workspace services launch specification");
// Keep environment values out of systemd-run arguments and exception messages. The specification is private, mode 0600.
try {
  const child = spawn(specification.command, specification.args, { cwd: specification.cwd, env: specification.env, stdio: "inherit" });
  child.on("error", launchFailed);
  child.on("close", (code) => { process.exitCode = code === null || code < 0 ? 1 : code; });
} catch (error) { launchFailed(error); }

function errorCode(error: unknown): string { return error instanceof Error && "code" in error ? String(error.code) : "unknown"; }
function launchFailed(error: unknown): void {
  process.stderr.write(`Workspace services command could not start: ${errorCode(error)}\n`);
  process.exitCode = 1;
}
