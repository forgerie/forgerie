import type { AppState } from "../appState";
import { LOCAL_MACHINE_ID } from "../machineKeys";

export function selectedMachineId(state: Pick<AppState, "selectedMachine">): string {
  return state.selectedMachine?.id ?? LOCAL_MACHINE_ID;
}

export type GetState = () => AppState;
export type SetState = (patch: Partial<AppState>) => void;
export type UpdateUrl = (options?: { replace?: boolean | undefined }) => void;

export interface RouteTarget {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  updateUrl?: boolean | undefined;
  /**
   * Optional guard injected by the inbox navigation helper. When provided,
   * `WorkspaceController.selectProject` / `selectWorkspace` check it after
   * every await so a superseded navigation never applies its final state.
   */
  isCurrent?: (() => boolean) | undefined;
}
