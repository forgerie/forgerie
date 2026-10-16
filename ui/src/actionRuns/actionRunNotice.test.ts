import { describe, expect, it } from "vitest";
import { convertMessage, fromHistory, reduceEvent } from "../transcript";
import { actionRunNoticeOf, noticeSentence, noticeTone } from "./actionRunNotice";
import { attemptText, conclusionText, failedConclusionText, failedText } from "./fixtures/notices";

describe("forgerie:action-run notices", () => {
  it("reads the watcher's fenced JSON news", () => {
    const notice = actionRunNoticeOf(failedText);
    expect(notice).toMatchObject({ repo: "forgerie/forgerie", runId: 4812, attempt: 1, workflow: "CI", conclusion: undefined, newAttempt: undefined,
      url: "https://github.com/forgerie/forgerie/actions/runs/4812" });
    expect(notice.failedJobs.map((job) => job.name)).toEqual(["test (ubuntu-latest, node 24)", "test (macos-latest, node 24)"]);
    expect(notice.text).toBe(failedText);
  });

  it("says what woke the agent in one line", () => {
    expect(noticeSentence(actionRunNoticeOf(failedText))).toBe("CI #4812: 2 jobs failed. The agent was woken.");
    expect(noticeSentence(actionRunNoticeOf(conclusionText))).toBe("Build SM8550 #4813 finished: success.");
    expect(noticeSentence(actionRunNoticeOf(attemptText))).toBe("CI #4812: attempt 2 started. The agent was woken.");
    expect(noticeSentence(actionRunNoticeOf(failedConclusionText))).toBe("CI #4812 finished: failure. 1 job failed. The agent was woken.");
  });

  it("tones a failure, a success, news while it runs, and an ending without a verdict", () => {
    expect(noticeTone(actionRunNoticeOf(failedText))).toBe("failed");
    expect(noticeTone(actionRunNoticeOf(conclusionText))).toBe("passed");
    expect(noticeTone(actionRunNoticeOf(attemptText))).toBe("active");
    expect(noticeTone(actionRunNoticeOf(conclusionText.replace('"success"', '"cancelled"')))).toBe("quiet");
  });

  it("still gives a line for text it cannot read", () => {
    expect(noticeSentence(actionRunNoticeOf("The run watcher has news."))).toBe("A workflow run: new activity. The agent was woken.");
    expect(noticeSentence(actionRunNoticeOf("```json\n{ not json\n```"))).toBe("A workflow run: new activity. The agent was woken.");
  });
});

describe("Actions run notices in the transcript", () => {
  it("turns a forgerie:action-run custom message into a notice row that does not join a reply", () => {
    const transcript = fromHistory([
      { role: "assistant", content: [{ type: "text", text: "Watching CI." }], timestamp: 1 },
      { role: "custom", customType: "forgerie:action-run", content: failedText, timestamp: 2 },
      { role: "assistant", content: [{ type: "text", text: "Reading the failures." }], timestamp: 3 },
    ]);
    expect(transcript.messages.map((message) => message.role)).toEqual(["assistant", "system", "assistant"]);
    expect(transcript.messages[1]).toMatchObject({ actionRunNotice: { runId: 4812, workflow: "CI" } });
    expect(convertMessage(transcript.messages[1]!)).toMatchObject({ role: "system", metadata: { custom: { actionRunNotice: { runId: 4812 } } } });
  });

  it("shows a wake that arrives live, while the session is open", () => {
    const live = reduceEvent(fromHistory([]), { type: "message.end", message: { role: "custom", customType: "forgerie:action-run", content: conclusionText, timestamp: 4 } });
    expect(live.messages.map((message) => message.actionRunNotice && noticeSentence(message.actionRunNotice))).toEqual(["Build SM8550 #4813 finished: success."]);
  });
});
