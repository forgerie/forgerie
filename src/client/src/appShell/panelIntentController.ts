import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";
import { DEFAULT_PANEL_INTENTS, dockedPanels, toggledIntent, type PanelIntent, type PanelIntents, type ShellPanel } from "./panelIntent";

const PANEL_INTENT_STORAGE_KEY = "pi-web-panel-intents";

export interface PanelIntentControllerOptions {
  measureShellWidth?: (() => number) | undefined;
}

/**
 * Owns what the user asked of each side panel, and answers what the shell should
 * therefore show. Intent is durable and global; presentation is derived from the
 * measured width every time it is read, so a fold or a resize never rewrites the
 * request behind it.
 */
export class PanelIntentController implements ReactiveController {
  intents: PanelIntents = readStoredPanelIntents();
  private readonly measureShellWidth: () => number;

  constructor(private readonly host: ReactiveControllerHost, options: PanelIntentControllerOptions = {}) {
    host.addController(this);
    this.measureShellWidth = options.measureShellWidth ?? (() => hostWidth(host));
  }

  hostConnected(): void {
    return;
  }

  isDocked(panel: ShellPanel): boolean {
    return dockedPanels(this.measureShellWidth(), this.intents)[panel];
  }

  /** The pin control: puts away what is on screen, keeps what is not. */
  toggle(panel: ShellPanel): void {
    this.setIntent(panel, toggledIntent(this.measureShellWidth(), this.intents, panel));
  }

  /** Asking for a panel by any other route is the same request as pinning it. */
  keep(panel: ShellPanel): void {
    if (this.isDocked(panel)) return;
    this.setIntent(panel, "pinned");
  }

  shellClass(mainView: AppState["mainView"]): string {
    return [
      "shell",
      mainViewClass(mainView),
      ...(this.isDocked("navigation") ? [] : ["navigation-panel-collapsed"]),
      ...(this.isDocked("workspace") ? [] : ["workspace-panel-collapsed"]),
    ].join(" ");
  }

  private setIntent(panel: ShellPanel, intent: PanelIntent): void {
    if (this.intents[panel] === intent) return;
    this.intents = { ...this.intents, [panel]: intent };
    writeStoredPanelIntents(this.intents);
    this.host.requestUpdate();
  }
}

export function mainViewClass(mainView: AppState["mainView"]): "navigation-view" | "chat-view" | "workspace-view" {
  if (mainView === "navigation") return "navigation-view";
  if (mainView === "chat") return "chat-view";
  return "workspace-view";
}

export function readStoredPanelIntents(): PanelIntents {
  try {
    const raw = window.localStorage.getItem(PANEL_INTENT_STORAGE_KEY);
    return raw === null ? DEFAULT_PANEL_INTENTS : parsePanelIntents(raw);
  } catch {
    return DEFAULT_PANEL_INTENTS;
  }
}

function writeStoredPanelIntents(intents: PanelIntents): void {
  try {
    window.localStorage.setItem(PANEL_INTENT_STORAGE_KEY, JSON.stringify(intents));
  } catch {
    // Ignore storage failures; the choice still holds for this tab.
  }
}

/** Unreadable storage falls back to the ladder rather than to a guessed pin. */
function parsePanelIntents(raw: string): PanelIntents {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_PANEL_INTENTS;
    return {
      navigation: panelIntentOrAuto(parsed["navigation"]),
      workspace: panelIntentOrAuto(parsed["workspace"]),
    };
  } catch {
    return DEFAULT_PANEL_INTENTS;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function panelIntentOrAuto(value: unknown): PanelIntent {
  return value === "pinned" || value === "dismissed" ? value : "auto";
}

function hostWidth(host: ReactiveControllerHost): number {
  if (!(host instanceof Element)) return 0;
  const measured = host.clientWidth;
  if (measured > 0) return measured;
  return typeof window === "undefined" ? 0 : window.innerWidth;
}
