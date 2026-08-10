import type { SessionInfo } from "./api";

export interface SelectedChatTarget {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd: string;
}

export type SelectedChatReadability = "absent" | "cached" | "fresh";

export type SelectedChatLoad =
  | { readonly kind: "no-target" }
  | { readonly kind: "loading-without-content"; readonly target: SelectedChatTarget }
  | { readonly kind: "loading-with-readable-history"; readonly target: SelectedChatTarget; readonly readability: Exclude<SelectedChatReadability, "absent"> }
  | { readonly kind: "cached-readable"; readonly target: SelectedChatTarget }
  | { readonly kind: "fresh-readable"; readonly target: SelectedChatTarget }
  | { readonly kind: "live-ready"; readonly target: SelectedChatTarget }
  | { readonly kind: "read-only"; readonly target: SelectedChatTarget; readonly readability: SelectedChatReadability }
  | { readonly kind: "failed"; readonly target: SelectedChatTarget; readonly readability: SelectedChatReadability; readonly error: string };

export function selectedChatTarget(machineId: string, session: Pick<SessionInfo, "id" | "cwd">): SelectedChatTarget {
  return { machineId, sessionId: session.id, cwd: session.cwd };
}

export function selectedChatNoTarget(): SelectedChatLoad {
  return { kind: "no-target" };
}

export function selectedChatLoading(target: SelectedChatTarget, readability: SelectedChatReadability = "absent"): SelectedChatLoad {
  if (readability === "absent") return { kind: "loading-without-content", target };
  return { kind: "loading-with-readable-history", target, readability };
}

export function selectedChatCachedReadable(target: SelectedChatTarget): SelectedChatLoad {
  return { kind: "cached-readable", target };
}

export function selectedChatFreshReadable(target: SelectedChatTarget): SelectedChatLoad {
  return { kind: "fresh-readable", target };
}

export function selectedChatLiveReady(target: SelectedChatTarget): SelectedChatLoad {
  return { kind: "live-ready", target };
}

export function selectedChatReadOnly(target: SelectedChatTarget, readability: SelectedChatReadability): SelectedChatLoad {
  return { kind: "read-only", target, readability };
}

export function selectedChatFailed(target: SelectedChatTarget, readability: SelectedChatReadability, error: unknown): SelectedChatLoad {
  return { kind: "failed", target, readability, error: String(error) };
}

export function selectedChatReadability(load: SelectedChatLoad): SelectedChatReadability {
  switch (load.kind) {
    case "no-target":
    case "loading-without-content":
      return "absent";
    case "loading-with-readable-history":
      return load.readability;
    case "cached-readable":
      return "cached";
    case "fresh-readable":
    case "live-ready":
      return "fresh";
    case "read-only":
    case "failed":
      return load.readability;
  }
}

export function selectedChatHasReadableHistory(load: SelectedChatLoad): boolean {
  return selectedChatReadability(load) !== "absent";
}

export function selectedChatCanUseRuntime(load: SelectedChatLoad): boolean {
  return load.kind === "live-ready";
}
