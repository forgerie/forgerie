import type { SelectedChatLoad, SelectedChatTarget } from "./selectedChatLoad";
import { selectedChatTargetsEqual } from "./selectedChatLoad";

export type ChatOpenMilestone =
  | "intent"
  | "shell-painted"
  | "cached-transcript-painted"
  | "preview-transcript-painted"
  | "fresh-transcript-painted"
  | "live-ready"
  | "read-only-ready"
  | "failed"
  | "superseded";

export const CHAT_OPEN_TIMING_NAMESPACE = "forgerie.chat-open";

export const CHAT_OPEN_TIMING_MARKS: Readonly<Record<ChatOpenMilestone, string>> = {
  intent: `${CHAT_OPEN_TIMING_NAMESPACE}.mark.intent`,
  "shell-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.shell-painted`,
  "cached-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.cached-transcript-painted`,
  "preview-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.preview-transcript-painted`,
  "fresh-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.fresh-transcript-painted`,
  "live-ready": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.live-ready`,
  "read-only-ready": `${CHAT_OPEN_TIMING_NAMESPACE}.mark.read-only-ready`,
  failed: `${CHAT_OPEN_TIMING_NAMESPACE}.mark.failed`,
  superseded: `${CHAT_OPEN_TIMING_NAMESPACE}.mark.superseded`,
};

export const CHAT_OPEN_TIMING_MEASURES: Readonly<Record<ChatOpenMilestone, string>> = {
  intent: `${CHAT_OPEN_TIMING_NAMESPACE}.measure.intent`,
  "shell-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.shell-painted`,
  "cached-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.cached-transcript-painted`,
  "preview-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.preview-transcript-painted`,
  "fresh-transcript-painted": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.fresh-transcript-painted`,
  "live-ready": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.live-ready`,
  "read-only-ready": `${CHAT_OPEN_TIMING_NAMESPACE}.measure.read-only-ready`,
  failed: `${CHAT_OPEN_TIMING_NAMESPACE}.measure.failed`,
  superseded: `${CHAT_OPEN_TIMING_NAMESPACE}.measure.superseded`,
};

interface UserTimingOptions {
  readonly startTime?: number;
  readonly detail?: unknown;
}

interface UserTimingMeasureOptions {
  readonly start?: number;
  readonly end?: number;
  readonly detail?: unknown;
}

export interface ChatOpenPerformanceLike {
  now(): number;
  mark(name: string, options?: UserTimingOptions): void;
  measure(name: string, options?: UserTimingMeasureOptions): void;
  clearMarks(name?: string): void;
  clearMeasures(name?: string): void;
}

export interface ChatOpenAttemptIdentity {
  readonly attemptId: number;
  readonly target: SelectedChatTarget;
}

export interface ChatOpenTimingOptions {
  readonly performance?: ChatOpenPerformanceLike;
  readonly maxAttempts?: number;
}

interface RecordedMilestone {
  readonly milestone: ChatOpenMilestone;
  readonly at: number;
}

interface RecordedAttempt {
  readonly attemptId: number;
  readonly target: SelectedChatTarget;
  readonly startedAt: number;
  readonly source: "navigation" | "retry";
  readonly milestones: readonly RecordedMilestone[];
  readonly terminal?: ChatOpenMilestone;
}

interface MutableAttempt {
  readonly attemptId: number;
  readonly target: SelectedChatTarget;
  readonly startedAt: number;
  readonly source: "navigation" | "retry";
  readonly milestones: Map<ChatOpenMilestone, RecordedMilestone>;
  terminal?: ChatOpenMilestone;
}

const TERMINAL_MILESTONES = new Set<ChatOpenMilestone>(["live-ready", "read-only-ready", "failed", "superseded"]);

export class ChatOpenTiming {
  private readonly performance: ChatOpenPerformanceLike | undefined;
  private readonly maxAttempts: number;
  private nextAttemptId = 0;
  private active: MutableAttempt | undefined;
  private readonly retained: MutableAttempt[] = [];

  constructor(options: ChatOpenTimingOptions = {}) {
    this.performance = options.performance ?? browserPerformance();
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 12));
  }

  begin(target: SelectedChatTarget, options: { readonly source?: "navigation" | "retry" } = {}): ChatOpenAttemptIdentity {
    this.supersedeActive();
    const attempt: MutableAttempt = {
      attemptId: ++this.nextAttemptId,
      target,
      startedAt: this.now(),
      source: options.source ?? "navigation",
      milestones: new Map(),
    };
    this.active = attempt;
    this.retained.push(attempt);
    this.record(attempt, "intent", attempt.startedAt);
    this.pruneAndReplayEntries();
    return { attemptId: attempt.attemptId, target };
  }

  markShellPainted(target: SelectedChatTarget): void {
    this.markActive(target, "shell-painted");
  }

  markSelectedLoadPainted(load: SelectedChatLoad): void {
    switch (load.kind) {
      case "cached-readable":
        this.markActive(load.target, "cached-transcript-painted");
        return;
      case "preview-readable":
        this.markActive(load.target, "preview-transcript-painted");
        return;
      case "fresh-readable":
        this.markActive(load.target, "fresh-transcript-painted");
        return;
      case "live-ready":
        this.markActive(load.target, "fresh-transcript-painted");
        this.markActive(load.target, "live-ready");
        return;
      case "read-only":
        if (load.readability === "cached") this.markActive(load.target, "cached-transcript-painted");
        if (load.readability === "fresh") this.markActive(load.target, "fresh-transcript-painted");
        this.markActive(load.target, "read-only-ready");
        return;
      case "failed":
        if (load.readability === "cached") this.markActive(load.target, "cached-transcript-painted");
        if (load.readability === "fresh") this.markActive(load.target, "fresh-transcript-painted");
        this.markActive(load.target, "failed");
        return;
      case "loading-with-readable-history":
        if (load.readability === "cached") this.markActive(load.target, "cached-transcript-painted");
        if (load.readability === "fresh") this.markActive(load.target, "fresh-transcript-painted");
        return;
      case "loading-without-content":
      case "no-target":
        return;
    }
  }

  supersedeActive(): void {
    const attempt = this.active;
    if (attempt === undefined || attempt.terminal !== undefined) return;
    this.record(attempt, "superseded", this.now());
    this.active = undefined;
    this.pruneAndReplayEntries();
  }

  snapshot(): readonly RecordedAttempt[] {
    return this.retained.map((attempt) => ({
      attemptId: attempt.attemptId,
      target: attempt.target,
      startedAt: attempt.startedAt,
      source: attempt.source,
      milestones: [...attempt.milestones.values()].sort((left, right) => left.at - right.at),
      ...(attempt.terminal === undefined ? {} : { terminal: attempt.terminal }),
    }));
  }

  private markActive(target: SelectedChatTarget, milestone: ChatOpenMilestone): void {
    const attempt = this.active;
    if (attempt === undefined) return;
    if (!selectedChatTargetsEqual(attempt.target, target)) return;
    if (attempt.terminal !== undefined) return;
    this.record(attempt, milestone, this.now());
    if (TERMINAL_MILESTONES.has(milestone)) this.active = undefined;
    this.pruneAndReplayEntries();
  }

  private record(attempt: MutableAttempt, milestone: ChatOpenMilestone, at: number): void {
    if (attempt.milestones.has(milestone)) return;
    if (attempt.terminal !== undefined) return;
    attempt.milestones.set(milestone, { milestone, at });
    if (TERMINAL_MILESTONES.has(milestone)) attempt.terminal = milestone;
    this.writeEntries(attempt, milestone, at);
  }

  private writeEntries(attempt: MutableAttempt, milestone: ChatOpenMilestone, at: number): void {
    const timing = this.performance;
    if (timing === undefined) return;
    const detail = this.entryDetail(attempt, milestone);
    timing.mark(CHAT_OPEN_TIMING_MARKS[milestone], { startTime: at, detail });
    timing.measure(CHAT_OPEN_TIMING_MEASURES[milestone], { start: attempt.startedAt, end: at, detail });
  }

  private entryDetail(attempt: MutableAttempt, milestone: ChatOpenMilestone): unknown {
    return {
      namespace: CHAT_OPEN_TIMING_NAMESPACE,
      attemptId: attempt.attemptId,
      milestone,
      source: attempt.source,
      target: attempt.target,
    };
  }

  private pruneAndReplayEntries(): void {
    if (this.retained.length > this.maxAttempts) this.retained.splice(0, this.retained.length - this.maxAttempts);
    this.replayEntries();
  }

  private replayEntries(): void {
    const timing = this.performance;
    if (timing === undefined) return;
    for (const name of Object.values(CHAT_OPEN_TIMING_MARKS)) timing.clearMarks(name);
    for (const name of Object.values(CHAT_OPEN_TIMING_MEASURES)) timing.clearMeasures(name);
    for (const attempt of this.retained) {
      for (const milestone of [...attempt.milestones.values()].sort((left, right) => left.at - right.at)) {
        this.writeEntries(attempt, milestone.milestone, milestone.at);
      }
    }
  }

  private now(): number {
    return this.performance?.now() ?? Date.now();
  }
}

export function createChatOpenTiming(options: ChatOpenTimingOptions = {}): ChatOpenTiming {
  return new ChatOpenTiming(options);
}

function browserPerformance(): ChatOpenPerformanceLike | undefined {
  if (typeof performance === "undefined") return undefined;
  if (typeof performance.mark !== "function" || typeof performance.measure !== "function") return undefined;
  return performance;
}
