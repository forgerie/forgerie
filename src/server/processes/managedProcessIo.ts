import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { hasCode } from "./managedProcessFiles.js";
import type { ManagedProcessInputResult, ManagedProcessRecord } from "./managedProcessTypes.js";

const execute = promisify(execFile);
// The helper, not the command, owns the write end. The command stays MainPID.
const keeper = `f=$1; shift
exec 3<>"$f"
{ read -r _ < "$f.eof"; } 4<&- &
exec "$@" < "$f" 3>&- 4<&-
`;
// fd 4 is a lifeline to Forgerie, not the managed process's stdin. This helper
// also handles SIGKILL of Forgerie. The attached command is still its child;
// a separate process group makes ordinary descendant cleanup possible.
const attachedKeeper = `f=$1; timeout=$2; shift 2
main=$$
{
  trap '' TERM
  read -r _ <&4
  kill -TERM -"$main" 2>/dev/null
  sleep "$timeout"
  kill -KILL -"$main" 2>/dev/null
} 3<&- &
${keeper.replace("f=$1; shift\n", "")}`;
const resultWriter = `const fs = require('node:fs');
const file = process.argv[2];
const content = [process.env.SERVICE_RESULT || 'unknown', process.env.EXIT_CODE || '', process.env.EXIT_STATUS || '', ''].join('\\n');
const fd = fs.openSync(file + '.tmp', 'w', 0o600);
try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(file + '.tmp', file);
const dir = fs.openSync(require('node:path').dirname(file), 'r');
try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
`;
export async function prepareProcessFiles(record: ManagedProcessRecord): Promise<void> {
  await writeFile(join(record.directory, "output.log"), "", { flag: "wx", mode: 0o600 });
  await execute("mkfifo", ["-m", "600", join(record.directory, "stdin"), join(record.directory, "stdin.eof")]);
  await writeFile(join(record.directory, "keeper.sh"), record.supervision.kind === "attached" ? attachedKeeper : keeper, { mode: 0o600 });
  await writeFile(join(record.directory, "result.cjs"), resultWriter, { mode: 0o600 });
}

/** Never waits for a reader or free pipe capacity. Retry only the unwritten suffix. */
export async function writeProcessInput(directory: string, input: Buffer | "eof"): Promise<ManagedProcessInputResult> {
  let bytesWritten = 0;
  try {
    const file = await open(join(directory, input === "eof" ? "stdin.eof" : "stdin"), constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      if (input !== "eof") {
        while (bytesWritten < input.length) {
          // PIPE_BUF-sized writes are atomic, including on a nonblocking FIFO.
          const length = Math.min(4096, input.length - bytesWritten);
          const written = await file.write(input, bytesWritten, length);
          bytesWritten += written.bytesWritten;
          if (written.bytesWritten === 0) return { kind: "stdin-full", bytesWritten };
        }
      }
      // Opening and closing the EOF FIFO releases the keeper, even with no data.
      return { kind: "written", bytesWritten };
    } finally { await file.close(); }
  } catch (error) {
    if (hasCode(error, "EAGAIN") || hasCode(error, "EWOULDBLOCK")) return { kind: "stdin-full", bytesWritten };
    if (hasCode(error, "ENXIO") || hasCode(error, "EPIPE") || hasCode(error, "ENOENT")) return { kind: "stdin-closed", bytesWritten };
    throw error;
  }
}
