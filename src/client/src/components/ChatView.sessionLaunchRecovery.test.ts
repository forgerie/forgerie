// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionLaunchRecovery } from "../controllers/sessionController";
import { ChatView, chatSessionLaunchRecoveryPresentation } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

describe("chatSessionLaunchRecoveryPresentation", () => {
  it("offers same-destination retry and destination change after creation fails", () => {
    expect(chatSessionLaunchRecoveryPresentation(recovery("creationFailed"))).toEqual({
      heading: "Session creation failed",
      detail: "The session was not created, so the first prompt was not sent. Any later queued messages wait behind it.",
      actions: [
        { kind: "retry", label: "Retry", disabled: false },
        { kind: "changeDestination", label: "Change destination", disabled: false },
      ],
    });
  });

  it("offers only retry when delivery is confirmed unsent", () => {
    expect(chatSessionLaunchRecoveryPresentation(recovery("promptConfirmedUnsent"))).toEqual({
      heading: "First prompt not sent",
      detail: "The session exists, but the first prompt was confirmed unsent. Any later queued messages wait behind it.",
      actions: [{ kind: "retry", label: "Retry", disabled: false }],
    });
  });

  it("offers transcript refresh and editor restoration without an automatic retry when delivery is ambiguous", () => {
    expect(chatSessionLaunchRecoveryPresentation(recovery("promptDeliveryAmbiguous"))).toEqual({
      heading: "First prompt delivery unconfirmed",
      detail: "The session exists, but Forgerie cannot verify whether the first prompt was accepted. Any later queued messages wait behind it.",
      actions: [
        { kind: "refresh", label: "Refresh transcript", disabled: false },
        { kind: "restore", label: "Restore to editor", disabled: false },
      ],
    });
  });

  it("reports a truthful busy state and disables creation recovery actions while retrying", () => {
    expect(chatSessionLaunchRecoveryPresentation({ ...recovery("creationFailed"), retrying: true })).toMatchObject({
      actions: [
        { kind: "retry", label: "Retrying…", disabled: true },
        { kind: "changeDestination", label: "Change destination", disabled: true },
      ],
    });
  });
});

describe("ChatView session launch recovery wiring", () => {
  it("attaches recovery to the first prompt before the queued tail and binds its actions to the rendered session", async () => {
    const view = new ChatView();
    const onRetry = vi.fn();
    const onChangeDestination = vi.fn();
    view.sessionId = "pending-session-1";
    view.clientQueuedMessages = [
      { kind: "followUp", text: "Recover this exact prompt" },
      { kind: "followUp", text: "Wait behind recovery" },
    ];
    view.sessionLaunchRecovery = recovery("creationFailed");
    view.onRetrySessionLaunch = onRetry;
    view.onChangeSessionLaunchDestination = onChangeDestination;
    document.body.append(view);
    await view.updateComplete;

    const queuedMessages = Array.from(view.shadowRoot?.querySelectorAll(".queued-message") ?? []);
    expect(queuedMessages[0]?.querySelector(".queued-kind")?.textContent.trim()).toBe("First prompt");
    expect(queuedMessages[0]?.querySelector<HTMLElement & { text: string }>("formatted-text")?.text).toBe("Recover this exact prompt");
    expect(queuedMessages[0]?.querySelector(".session-launch-recovery")).not.toBeNull();
    expect(queuedMessages[0]?.textContent).toContain("Any later queued messages wait behind it");
    expect(queuedMessages[1]?.querySelector<HTMLElement & { text: string }>("formatted-text")?.text).toBe("Wait behind recovery");
    expect(view.shadowRoot?.querySelector(".queued-heading strong")?.textContent).toBe("First prompt needs attention");
    expect(view.shadowRoot?.querySelector(".queued-heading small")?.textContent).toBe("Resolve it before later queued messages can continue");
    const buttons = Array.from(view.shadowRoot?.querySelectorAll<HTMLButtonElement>(".session-launch-recovery button") ?? []);
    expect(buttons.map((button) => button.textContent.trim())).toEqual(["Retry", "Change destination"]);

    view.sessionId = "newly-selected-session";
    buttons[0]?.click();
    buttons[1]?.click();

    expect(onRetry).toHaveBeenCalledExactlyOnceWith("pending-session-1");
    expect(onChangeDestination).toHaveBeenCalledExactlyOnceWith("pending-session-1");
  });

  it("keeps ordinary no-recovery queue copy and labels unchanged", async () => {
    const view = new ChatView();
    view.clientQueuedMessages = [{ kind: "followUp", text: "Ordinary queued prompt" }];
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".queued-heading strong")?.textContent).toBe("Queued until session starts");
    expect(view.shadowRoot?.querySelector(".queued-heading small")?.textContent).toBe("Will send once the backend session is ready");
    expect(view.shadowRoot?.querySelector(".queued-kind")?.textContent.trim()).toBe("Follow-up 1");
    expect(view.shadowRoot?.querySelector<HTMLElement & { text: string }>(".queued-message formatted-text")?.text).toBe("Ordinary queued prompt");
    expect(view.shadowRoot?.querySelector(".session-launch-recovery")).toBeNull();
  });
});

function recovery(stage: SessionLaunchRecovery["stage"]): SessionLaunchRecovery {
  return {
    stage,
    sessionId: stage === "creationFailed" ? "pending-session-1" : "session-1",
    destination: { machineId: "local", workspaceId: "workspace-1", cwd: "/repo" },
    prompt: "Recover this exact prompt",
    retrying: false,
  };
}
