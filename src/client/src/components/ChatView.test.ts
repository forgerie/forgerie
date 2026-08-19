import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { QueuedSessionMessage, SessionStatus, SessionWarning } from "../api";
import type { ChatLine } from "./shared";
import {
  ChatView,
  chatEventAnchorKey,
  chatGroupAnchorKey,
  chatGroupScrollMarkerId,
  chatMessageGroupClassName,
  chatMessageMetadataLabel,
  chatQueuedGhostActionLabel,
  chatQueuedMessageSections,
  chatSessionWarningRows,
} from "./ChatView";
import { templateEventHandlerAfterMarker, templateEventHandlerNearMarker, templateText } from "../templateInspection.testSupport";

describe("chatQueuedMessageSections", () => {
  it("labels client-side pending-start sends as waiting on the session", () => {
    const sections = chatQueuedMessageSections([{ kind: "followUp", text: "queued before start" }]);

    expect(sections).toEqual([{
      heading: "Queued until session starts",
      detail: "Will send once the backend session is ready",
      messages: [{ kind: "followUp", text: "queued before start" }],
    }]);
  });

  // The server queue renders as ghosts of the messages it will become, so it
  // is deliberately absent from the chrome-bearing section model.
  it("leaves the server queue out of the labelled sections", () => {
    expect(chatQueuedMessageSections([])).toEqual([]);
  });

  it("synthesizes the recoverable first prompt when the machine-scoped client queue is unavailable", () => {
    const sections = chatQueuedMessageSections([], {
      stage: "promptDeliveryAmbiguous",
      sessionId: "session-1",
      destination: { machineId: "remote", workspaceId: "workspace-1", cwd: "/repo" },
      retrying: false,
    });

    expect(sections).toEqual([{
      heading: "First prompt needs attention",
      detail: "Resolve it before later queued messages can continue",
      messages: [{ kind: "followUp", text: "[First prompt retained privately]" }],
    }]);
  });
});

describe("chatQueuedGhostActionLabel", () => {
  // The action always clears the whole server queue, so the label only promises
  // to remove one message when one message is all there is to lose.
  it("offers to remove the only queued message", () => {
    expect(chatQueuedGhostActionLabel(1)).toBe("remove");
  });

  it("says the action clears every queued message once more than one would go", () => {
    expect(chatQueuedGhostActionLabel(3)).toBe("clear all");
  });
});

describe("ChatView queued-ghost clear wiring", () => {
  // Escape hatch: this case verifies the clear action's Lit event wiring, whose
  // only observable effect is invoking the injected callback. Vitest runs with
  // no DOM environment here, so a shadow-DOM click harness would add
  // disproportionate setup; handler extraction anchored to the stable
  // `queued-ghost-clear` class marker is proportionate.
  it("invokes onClearServerQueue when the ghost stack's clear action is activated", () => {
    const view = new ChatView();
    const onClearServerQueue = vi.fn();
    view.status = queuedStatus([{ kind: "steer", text: "server queued" }]);
    view.onClearServerQueue = onClearServerQueue;

    const rendered = renderQueuedGhosts(view);
    if (rendered === null) throw new Error("expected a queued-ghost stack");
    templateEventHandlerNearMarker(rendered, "queued-ghost-clear")(new Event("click"));

    expect(onClearServerQueue).toHaveBeenCalledOnce();
  });

  it("stays out of the transcript when nothing is queued", () => {
    expect(renderQueuedGhosts(withStatus(new ChatView(), queuedStatus([])))).toBeNull();
  });
});

describe("chatSessionWarningRows", () => {
  // Warning-row content (severity class, message, path, source, dismiss
  // capability, ordering) is derived by a pure exported seam rather than scraped
  // from rendered `TemplateResult` markup, per the testing-guide rule that
  // TemplateResult inspection is not for general content assertions.
  it("derives one severity-tagged row per warning with optional path and source", () => {
    const rows = chatSessionWarningRows(warningStatus([
      { severity: "error", message: "skill failed to load", source: "skill", path: "/skills/a.md" },
      { severity: "warning", message: "subscription auth is active" },
      { severity: "info", message: "heads up", source: "runtime" },
    ]));

    expect(rows).toEqual([
      { severity: "error", severityClass: "session-warning error", message: "skill failed to load", source: "skill", path: "/skills/a.md", dismissId: undefined },
      { severity: "warning", severityClass: "session-warning warning", message: "subscription auth is active", source: undefined, path: undefined, dismissId: undefined },
      { severity: "info", severityClass: "session-warning info", message: "heads up", source: "runtime", path: undefined, dismissId: undefined },
    ]);
  });

  it("exposes a dismiss id only for warnings carrying a dismiss capability", () => {
    const rows = chatSessionWarningRows(warningStatus([
      { severity: "error", message: "skill failed to load", source: "skill" },
      { severity: "warning", message: "subscription auth is active", source: "anthropic", dismiss: { id: "anthropicExtraUsage" } },
    ]));

    expect(rows.map((row) => row.dismissId)).toEqual([undefined, "anthropicExtraUsage"]);
  });

  it("derives no rows when there are no warnings or status is unset", () => {
    expect(chatSessionWarningRows(warningStatus([]))).toEqual([]);
    expect(chatSessionWarningRows(undefined)).toEqual([]);
  });
});

describe("ChatView transcript liveness", () => {
  it("reports the session's activity inside the transcript while work is running", () => {
    const view = withStatus(new ChatView(), queuedStatus([]));

    const rendered = renderTranscriptLiveness(view);
    if (rendered === null) throw new Error("expected a liveness line while streaming");
    expect(templateText(rendered)).toContain("running");
  });

  it("reports a prompt in flight before the session reports streaming", () => {
    const view = withStatus(new ChatView(), idleStatus());
    view.isSendingPrompt = true;

    const rendered = renderTranscriptLiveness(view);
    if (rendered === null) throw new Error("expected a liveness line while sending");
    expect(templateText(rendered)).toContain("Sending your message");
  });

  it("stays out of the transcript when the session is idle", () => {
    expect(renderTranscriptLiveness(withStatus(new ChatView(), idleStatus()))).toBeNull();
  });

  // Compaction used to get its own explanatory notice. It is a stretch of work
  // like any other, so it names itself on the one liveness line instead.
  it("names compaction as the running step", () => {
    const view = withStatus(new ChatView(), { ...queuedStatus([]), isCompacting: true });
    view.isCompacting = true;

    const rendered = renderTranscriptLiveness(view);
    if (rendered === null) throw new Error("expected a liveness line while compacting");
    expect(templateText(rendered)).toContain("compacting history");
  });

  // The latest tool call would otherwise leak in from the turn that just ended.
  it("does not name the finished turn's last tool call while compacting", () => {
    const view = withStatus(new ChatView(), { ...queuedStatus([]), isCompacting: true });
    view.isCompacting = true;
    view.messages = [toolCallLine("read", "archive.ts")];

    const rendered = renderTranscriptLiveness(view);
    if (rendered === null) throw new Error("expected a liveness line while compacting");
    expect(templateText(rendered)).not.toContain("archive.ts");
  });
});

describe("ChatView session-warning dismiss wiring", () => {
  // Escape hatch: this case verifies the dismiss button's Lit event wiring,
  // whose observable effect is invoking onDismissWarning with the warning's
  // dismiss id. No DOM environment is available, so handler extraction anchored
  // to the stable `session-warning-dismiss` class marker is proportionate.
  it("invokes onDismissWarning with the warning's dismiss id", () => {
    const view = new ChatView();
    const onDismissWarning = vi.fn();
    view.onDismissWarning = onDismissWarning;
    view.status = warningStatus([
      { severity: "warning", message: "subscription auth is active", source: "anthropic", dismiss: { id: "anthropicExtraUsage" } },
    ]);

    const rendered = renderWarnings(view);
    if (rendered === null) throw new Error("expected a warnings banner");
    templateEventHandlerAfterMarker(rendered, "session-warning-dismiss")(new Event("click"));

    expect(onDismissWarning).toHaveBeenCalledExactlyOnceWith("anthropicExtraUsage");
  });

  // Escape hatch: this verifies the minimise chevron's Lit callback wiring in
  // the node test environment, anchored to its stable semantic class marker.
  // The chevron is wired to the unified onToggleWarnings (toggle ≡ collapse in
  // the expanded state), so this also proves the single visibility mutation.
  it("invokes onToggleWarnings from the visible warning area", () => {
    const view = withStatus(new ChatView(), warningStatus([
      { severity: "warning", message: "subscription auth is active" },
    ]));
    const onToggleWarnings = vi.fn();
    view.onToggleWarnings = onToggleWarnings;

    const rendered = renderWarnings(view);
    if (rendered === null) throw new Error("expected a warnings banner");
    templateEventHandlerAfterMarker(rendered, "session-warnings-collapse")(new Event("click"));

    expect(onToggleWarnings).toHaveBeenCalledOnce();
  });

  it("removes the warning area while presentation is collapsed or there are no warnings", () => {
    const view = withStatus(new ChatView(), warningStatus([
      { severity: "warning", message: "subscription auth is active" },
    ]));
    view.warningsVisible = false;

    expect(renderWarnings(view)).toBeNull();
    expect(renderWarnings(withStatus(new ChatView(), warningStatus([])))).toBeNull();
  });
});

describe("chatMessageMetadataLabel", () => {
  const timestamp = "2026-07-10T19:15:30.000Z";
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(timestamp));
  const sameDay = new Date(timestamp);
  const sameYear = new Date("2026-12-01T00:00:00.000Z");
  const otherYear = new Date("2027-03-01T00:00:00.000Z");

  it("shows only the time for same-day messages and drops the provider route", () => {
    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "cliproxyapi", id: "claude-fable-5" } },
    }, sameDay)).toBe(`${time} · Claude Fable 5`);
  });

  it("adds month and day within the year and the full date beyond it", () => {
    const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
    const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
    const line = (now: Date) => chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "gpt-5.6-sol" } },
    }, now);

    expect(line(sameYear)).toBe(`${day}, ${time} · GPT 5.6 Sol`);
    expect(line(otherYear)).toBe(`${fullDate}, ${time} · GPT 5.6 Sol`);
  });

  it("labels the thinking level as effort after the model", () => {
    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" }, thinkingLevel: "high" },
    }, sameDay)).toBe(`${time} · Model · high effort`);
  });
});

describe("chat event-group content seams", () => {
  // Group scroll-anchor keys, marker ids, class list, and disclosure label are
  // content/structure derived from pure exported seams rather than scraped from
  // rendered markup.
  it("derives stable group and event scroll-anchor keys and marker ids", () => {
    expect(chatGroupAnchorKey(40)).toBe("g:40");
    expect(chatEventAnchorKey(40)).toBe("e:40");
    expect(chatEventAnchorKey(41)).toBe("e:41");
    expect(chatGroupScrollMarkerId(41)).toBe("g:41");
  });

  it("distinguishes the live tail group by class", () => {
    expect(chatMessageGroupClassName(true)).toBe("msg event-group live");
    expect(chatMessageGroupClassName(false)).toBe("msg event-group");
  });
});

describe("ChatView event-group disclosure wiring", () => {
  const messages: ChatLine[] = [
    { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect a file" }] },
    { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "inspect a file", status: "success", resultText: "large result" }] },
  ];

  it("defers a closed group body until it is opened", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
  });

  it("keeps the live tail body closed so streaming activity stays out of view", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    renderMessageGroup(view, messages, 40, 41, true);

    expect(bodyCalls).toEqual([]);
  });

  it("opens the live tail when it is toggled, and keeps it open as events arrive", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);
    const closed = renderMessageGroup(view, messages, 40, 41, true);

    dispatchDetailsToggle(templateEventHandlerAfterMarker(closed, "@toggle="), true);
    // The tail grows: same start, later end. The disclosure must survive it.
    renderMessageGroup(view, messages, 40, 43, true);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
  });

  // Escape hatch: this case verifies the native `<details>` `@toggle` wiring,
  // whose observable effect is that a re-render renders (or defers) the group
  // body. No DOM environment is available for a real disclosure interaction, so
  // handler extraction anchored to the stable `@toggle=` attribute marker plus
  // an injected details-toggle event is proportionate.
  it("renders the body after a toggle-open and removes it when closed again", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);
    const initiallyClosed = renderMessageGroup(view, messages, 40, 41, false);

    dispatchDetailsToggle(templateEventHandlerAfterMarker(initiallyClosed, "@toggle="), true);
    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);

    bodyCalls.length = 0;
    dispatchDetailsToggle(templateEventHandlerAfterMarker(initiallyClosed, "@toggle="), false);
    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
  });
});

interface GroupBodyRenderCall {
  messages: ChatLine[];
  startIndex: number;
}

type RenderQueuedGhosts = (this: ChatView) => TemplateResult | null;
type RenderMessageGroup = (this: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) => TemplateResult;
type RenderMessageGroupBody = (this: ChatView, messages: ChatLine[], startIndex: number) => TemplateResult;
type RenderWarnings = (this: ChatView) => TemplateResult | null;
type TemplateEventHandler = (event: Event) => void;

function renderQueuedGhosts(view: ChatView): TemplateResult | null {
  const method: unknown = Reflect.get(view, "renderQueuedGhosts");
  if (!isRenderQueuedGhosts(method)) throw new Error("ChatView.renderQueuedGhosts is not callable");
  return method.call(view);
}

function renderMessageGroup(view: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean): TemplateResult {
  const method: unknown = Reflect.get(view, "renderMessageGroup");
  if (!isRenderMessageGroup(method)) throw new Error("ChatView.renderMessageGroup is not callable");
  return method.call(view, messages, startIndex, endIndex, defaultOpen);
}

function renderWarnings(view: ChatView): TemplateResult | null {
  const method: unknown = Reflect.get(view, "renderWarnings");
  if (!isRenderWarnings(method)) throw new Error("ChatView.renderWarnings is not callable");
  return method.call(view);
}

function observeGroupBodyRenders(view: ChatView): GroupBodyRenderCall[] {
  const method: unknown = Reflect.get(view, "renderMessageGroupBody");
  if (!isRenderMessageGroupBody(method)) throw new Error("ChatView.renderMessageGroupBody is not callable");
  const calls: GroupBodyRenderCall[] = [];
  const observed: RenderMessageGroupBody = function (messages, startIndex) {
    calls.push({ messages, startIndex });
    return method.call(this, messages, startIndex);
  };
  if (!Reflect.set(view, "renderMessageGroupBody", observed)) throw new Error("Could not observe ChatView.renderMessageGroupBody");
  return calls;
}

function isRenderQueuedGhosts(value: unknown): value is RenderQueuedGhosts {
  return typeof value === "function";
}

function isRenderMessageGroup(value: unknown): value is RenderMessageGroup {
  return typeof value === "function";
}

function isRenderMessageGroupBody(value: unknown): value is RenderMessageGroupBody {
  return typeof value === "function";
}

function isRenderWarnings(value: unknown): value is RenderWarnings {
  return typeof value === "function";
}

function dispatchDetailsToggle(handler: TemplateEventHandler, open: boolean): void {
  const hadDetailsElement = Reflect.has(globalThis, "HTMLDetailsElement");
  const previousDetailsElement = Reflect.get(globalThis, "HTMLDetailsElement");
  class StubDetailsElement extends EventTarget {
    constructor(readonly open: boolean) {
      super();
    }
  }
  Reflect.set(globalThis, "HTMLDetailsElement", StubDetailsElement);
  try {
    const details = new StubDetailsElement(open);
    details.addEventListener("toggle", (event) => { handler(event); });
    details.dispatchEvent(new Event("toggle"));
  } finally {
    if (hadDetailsElement) Reflect.set(globalThis, "HTMLDetailsElement", previousDetailsElement);
    else Reflect.deleteProperty(globalThis, "HTMLDetailsElement");
  }
}

function toolCallLine(toolName: string, summary: string): ChatLine {
  return { role: "assistant", parts: [{ type: "toolCall", toolName, summary }] };
}

function withStatus(view: ChatView, status: SessionStatus): ChatView {
  view.status = status;
  return view;
}

function warningStatus(warnings: SessionWarning[]): SessionStatus {
  return {
    ...queuedStatus([]),
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}

function renderTranscriptLiveness(view: ChatView): TemplateResult | null {
  const method: unknown = Reflect.get(view, "renderTranscriptLiveness");
  if (!isRenderWarnings(method)) throw new Error("ChatView.renderTranscriptLiveness is not callable");
  return method.call(view);
}

function idleStatus(): SessionStatus {
  return { ...queuedStatus([]), isStreaming: false };
}

function queuedStatus(queuedMessages: QueuedSessionMessage[]): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: queuedMessages.length,
    queuedMessages,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}
