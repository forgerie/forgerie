import type { PullSessionGateway } from "../github/pullRequestService.js";
import type { ProjectWorkspaces } from "./projectWorkspaces.js";
/** PR data stays repo-scoped; notices and merge receipts return to the owning chat. */
export function relatedPullSessions(work: Pick<ProjectWorkspaces, "owner">, sessions: PullSessionGateway): PullSessionGateway {
  return {
    async inspect(ref) {
      const owner = await work.owner(ref);
      const state = await sessions.inspect(owner.ref);
      return { ...state, ref, available: owner.active && state.available };
    },
    async wake(ref, notice, current) {
      const owner = await work.owner(ref);
      return owner.active ? sessions.wake(owner.ref, notice, current) : "busy";
    },
    async note(ref, note) {
      const owner = await work.owner(ref);
      if (owner.active) await sessions.note?.(owner.ref, note);
    },
  };
}
