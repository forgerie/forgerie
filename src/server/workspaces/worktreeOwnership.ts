import { Type } from "typebox";
import { Check } from "typebox/value";
import { SessionWorktreeRecordSchema } from "../../shared/sessionWorktree.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";

export interface WorktreeOwnershipProbe { owns(cwd: string): Promise<boolean> }
const InventorySchema = Type.Object({ worktrees: Type.Array(SessionWorktreeRecordSchema) });

/** The generic workspace delete action must not bypass session receipts and discard confirmation. */
export function sessionWorktreeOwnershipProbe(daemon: SessionProxyDaemon): WorktreeOwnershipProbe {
  return {
    async owns(cwd) {
      const response = await daemon.request("GET", `/sessions/worktrees?cwd=${encodeURIComponent(cwd)}`);
      if (response.statusCode !== 200) throw new Error("Cannot verify session worktree ownership. Retry when sessiond is available.");
      const body: unknown = JSON.parse(response.body);
      if (!Check(InventorySchema, body)) throw new Error("Invalid session worktree ownership response");
      return body.worktrees.some((record) => record.path === cwd && record.cleanup.kind !== "done");
    },
  };
}
