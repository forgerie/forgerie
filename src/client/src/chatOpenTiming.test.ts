import { describe, expect, it } from "vitest";
import { CHAT_OPEN_TIMING_MARKS, CHAT_OPEN_TIMING_MEASURES, ChatOpenTiming, type ChatOpenPerformanceLike } from "./chatOpenTiming";
import { selectedChatCachedReadable, selectedChatFailed, selectedChatFreshReadable, selectedChatLiveReady, selectedChatPreviewReadable, selectedChatReadOnly, selectedChatTarget, type SelectedChatTarget } from "./selectedChatLoad";
import type { SessionInfo } from "./api";

interface RecordedEntry {
  readonly type: "mark" | "measure";
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly detail: unknown;
}

class RecordingPerformance implements ChatOpenPerformanceLike {
  time = 0;
  readonly entries: RecordedEntry[] = [];

  now(): number {
    return this.time;
  }

  mark(name: string, options: { readonly startTime?: number; readonly detail?: unknown } = {}): void {
    this.entries.push({ type: "mark", name, startTime: options.startTime ?? this.time, duration: 0, detail: options.detail });
  }

  measure(name: string, options: { readonly start?: number; readonly end?: number; readonly detail?: unknown } = {}): void {
    const start = options.start ?? 0;
    const end = options.end ?? this.time;
    this.entries.push({ type: "measure", name, startTime: start, duration: end - start, detail: options.detail });
  }

  clearMarks(name?: string): void {
    this.clear("mark", name);
  }

  clearMeasures(name?: string): void {
    this.clear("measure", name);
  }

  advance(ms: number): void {
    this.time += ms;
  }

  private clear(type: "mark" | "measure", name: string | undefined): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry?.type === type && (name === undefined || entry.name === name)) this.entries.splice(index, 1);
    }
  }
}

describe("ChatOpenTiming", () => {
  it("records intent, shell, fresh transcript, and live-ready in order", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const target = targetFor("alpha");

    timing.begin(target);
    performance.advance(12);
    timing.markShellPainted(target);
    performance.advance(20);
    timing.markSelectedLoadPainted(selectedChatFreshReadable(target));
    performance.advance(8);
    timing.markSelectedLoadPainted(selectedChatLiveReady(target));

    expect(measureMilestones(performance)).toEqual(["intent", "shell-painted", "fresh-transcript-painted", "live-ready"]);
    expect(measureDuration(performance, "shell-painted")).toBe(12);
    expect(measureDuration(performance, "fresh-transcript-painted")).toBe(32);
    expect(measureDuration(performance, "live-ready")).toBe(40);
  });

  it("records cached transcript before fresh transcript on a cache hit", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const target = targetFor("cached");

    timing.begin(target);
    performance.advance(4);
    timing.markSelectedLoadPainted(selectedChatCachedReadable(target));
    performance.advance(9);
    timing.markSelectedLoadPainted(selectedChatFreshReadable(target));

    expect(measureMilestones(performance)).toEqual(["intent", "cached-transcript-painted", "fresh-transcript-painted"]);
  });

  it("records a bounded network preview separately from a cache hit", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const target = targetFor("preview");

    timing.begin(target);
    performance.advance(6);
    timing.markSelectedLoadPainted(selectedChatPreviewReadable(target));

    expect(measureMilestones(performance)).toEqual(["intent", "preview-transcript-painted"]);
  });

  it("ends read-only selections without inventing live-ready", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const target = targetFor("archived");

    timing.begin(target);
    timing.markSelectedLoadPainted(selectedChatReadOnly(target, "fresh"));
    timing.markSelectedLoadPainted(selectedChatLiveReady(target));

    expect(measureMilestones(performance)).toEqual(["intent", "fresh-transcript-painted", "read-only-ready"]);
    expect(hasMeasure(performance, "live-ready")).toBe(false);
  });

  it("supersedes the active target attempt and keeps the next target separate", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const alpha = targetFor("alpha");
    const beta = targetFor("beta");

    timing.begin(alpha);
    performance.advance(3);
    timing.begin(beta);
    performance.advance(7);
    timing.markShellPainted(alpha);
    timing.markShellPainted(beta);
    timing.markSelectedLoadPainted(selectedChatLiveReady(beta));

    const attempts = timing.snapshot();
    expect(attempts.map((attempt) => attempt.terminal)).toEqual(["superseded", "live-ready"]);
    expect(measureMilestones(performance)).toEqual(["intent", "superseded", "intent", "shell-painted", "fresh-transcript-painted", "live-ready"]);
    expect(measureTargets(performance, "shell-painted")).toEqual([beta]);
  });

  it("records failure after readable milestones without recording live readiness", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance });
    const target = targetFor("failed");

    timing.begin(target);
    timing.markSelectedLoadPainted(selectedChatFreshReadable(target));
    performance.advance(5);
    timing.markSelectedLoadPainted(selectedChatFailed(target, "fresh", "join failed"));
    timing.markSelectedLoadPainted(selectedChatLiveReady(target));

    expect(measureMilestones(performance)).toEqual(["intent", "fresh-transcript-painted", "failed"]);
    expect(hasMeasure(performance, "live-ready")).toBe(false);
  });

  it("keeps marks idempotent, target-identity guarded, and bounded", () => {
    const performance = new RecordingPerformance();
    const timing = new ChatOpenTiming({ performance, maxAttempts: 2 });
    const first = targetFor("first");
    const second = targetFor("second");
    const third = targetFor("third");

    timing.begin(first);
    timing.markShellPainted({ ...first, cwd: "/other" });
    timing.markShellPainted(first);
    timing.markShellPainted(first);
    timing.begin(second);
    timing.begin(third);

    expect(measureTargets(performance, "shell-painted")).toEqual([]);
    expect(timing.snapshot().map((attempt) => attempt.target.sessionId)).toEqual(["second", "third"]);
    expect(measureMilestones(performance)).toEqual(["intent", "superseded", "intent"]);
  });
});

function measureMilestones(performance: RecordingPerformance): string[] {
  return performance.entries
    .filter((entry) => entry.type === "measure")
    .map((entry) => String(detailField(entry.detail, "milestone")));
}

function measureDuration(performance: RecordingPerformance, milestone: keyof typeof CHAT_OPEN_TIMING_MEASURES): number {
  const entry = performance.entries.find((candidate) => candidate.type === "measure" && candidate.name === CHAT_OPEN_TIMING_MEASURES[milestone]);
  if (entry === undefined) throw new Error(`No ${milestone} measure`);
  return entry.duration;
}

function hasMeasure(performance: RecordingPerformance, milestone: keyof typeof CHAT_OPEN_TIMING_MEASURES): boolean {
  return performance.entries.some((entry) => entry.type === "measure" && entry.name === CHAT_OPEN_TIMING_MEASURES[milestone]);
}

function measureTargets(performance: RecordingPerformance, milestone: keyof typeof CHAT_OPEN_TIMING_MARKS): SelectedChatTarget[] {
  return performance.entries
    .filter((entry) => entry.type === "measure" && entry.name === CHAT_OPEN_TIMING_MEASURES[milestone])
    .flatMap((entry) => selectedTargetFromDetail(entry.detail));
}

function detailField(detail: unknown, field: string): unknown {
  if (typeof detail !== "object" || detail === null) return undefined;
  return Reflect.get(detail, field);
}

function selectedTargetFromDetail(detail: unknown): SelectedChatTarget[] {
  const target = detailField(detail, "target");
  if (!isSelectedChatTarget(target)) return [];
  return [target];
}

function isSelectedChatTarget(value: unknown): value is SelectedChatTarget {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "machineId") === "string"
    && typeof Reflect.get(value, "sessionId") === "string"
    && typeof Reflect.get(value, "cwd") === "string";
}

function targetFor(sessionId: string): SelectedChatTarget {
  return selectedChatTarget("local", session(sessionId));
}

function session(id: string): Pick<SessionInfo, "id" | "cwd"> {
  return { id, cwd: "/repo" };
}
