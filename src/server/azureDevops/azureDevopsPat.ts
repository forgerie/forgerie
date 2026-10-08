import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

export type AzureCredential = { ok: true; token: string } | { ok: false; message: string };

/** Read on each request so replacing or removing a PAT needs no daemon restart. */
export class AzureDevopsPatStore {
  constructor(private readonly directory: string) {}

  async read(organization: string): Promise<AzureCredential> {
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/iu.test(organization)) return { ok: false, message: "Invalid Azure DevOps organization." };
    const path = join(this.directory, `${organization.toLowerCase()}.pat`);
    const fix = `Store an organization-scoped PAT with Work Items: Read permission in ${path}, owned by the Forgerie user with mode 0600. Never put it in project config or chat.`;
    try {
      // O_NONBLOCK also prevents an accidentally supplied FIFO from hanging the daemon.
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())) {
          return { ok: false, message: `Azure DevOps credential file is not a private regular file. ${fix}` };
        }
        const token = (await file.readFile("utf8")).trim();
        if (!/^[A-Za-z0-9]{20,4096}$/u.test(token)) return { ok: false, message: `Azure DevOps credential file is empty or malformed. ${fix}` };
        return { ok: true, token };
      } finally { await file.close(); }
    } catch {
      // Filesystem errors and credential bytes must never enter browser responses or logs.
      return { ok: false, message: `Azure DevOps credentials are missing or unreadable. ${fix}` };
    }
  }
}
