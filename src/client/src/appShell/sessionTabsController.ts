import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { QualifiedContributionId } from "../plugins/ids";
import { closeSessionTab, promoteSessionTab, readStoredSessionTabs, reconciledMainView, sessionTabsFor, writeStoredSessionTabs, type SessionTabsBySession } from "./sessionTabs";

/**
 * Owns the durable per-session tab sets, following the panel-intent pattern:
 * the choice is durable and stored; what the shell shows is derived from it
 * at render time. Chat is implicit and never stored.
 */
export class SessionTabsController implements ReactiveController {
  private tabs: SessionTabsBySession = readStoredSessionTabs();

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    return;
  }

  tabsFor(sessionKey: string | undefined): readonly QualifiedContributionId[] {
    return sessionTabsFor(this.tabs, sessionKey);
  }

  promote(sessionKey: string, tool: QualifiedContributionId): void {
    this.replace(promoteSessionTab(this.tabs, sessionKey, tool));
  }

  close(sessionKey: string, tool: QualifiedContributionId): void {
    this.replace(closeSessionTab(this.tabs, sessionKey, tool));
  }

  /** What the main view may be, given the session's tabs. */
  reconciledMainView<View extends string>(sessionKey: string | undefined, view: View): View | "chat" {
    return reconciledMainView(this.tabs, sessionKey, view);
  }

  private replace(next: SessionTabsBySession): void {
    if (next === this.tabs) return;
    this.tabs = next;
    writeStoredSessionTabs(next);
    this.host.requestUpdate();
  }
}
