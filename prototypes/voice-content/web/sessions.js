// PROTOTYPE fixtures: scripted agent runs.
//
// Each step can put a block on screen, offer the voice an act, or both. The
// spoken line is written for the ear and never repeats the block. `activity`
// lets the engine build its own "still working" line when a wait runs long.

export const SESSIONS = [
  {
    id: "reconnect",
    title: "Reconnect bug",
    summary: "One long task with a real decision in the middle.",
    opening: "The web app drops my session when my phone sleeps. Find out why, then fix it.",
    steps: [
      {
        id: "b1",
        after: 700,
        block: {
          kind: "say",
          text: "I'll trace the reconnect path: client socket, server hub, then session attach. Starting with the client.",
        },
        say: { type: "orient", text: "Right. I am tracing how the socket comes back after sleep." },
      },
      {
        id: "b2",
        after: 900,
        block: { kind: "tool", name: "read", target: "src/client/src/realtime/socket.ts", meta: "312 lines" },
        say: { type: "progress", text: "Reading the client socket.", mergeKey: "read", mergedText: "Reading {n} files." },
      },
      {
        id: "b3",
        after: 650,
        block: { kind: "tool", name: "read", target: "src/server/realtime/hub.ts", meta: "204 lines" },
        say: { type: "progress", text: "Reading the server hub.", mergeKey: "read", mergedText: "Reading {n} files." },
      },
      {
        id: "b4",
        after: 600,
        block: { kind: "tool", name: "read", target: "src/server/sessiond/attach.ts", meta: "158 lines" },
        say: { type: "progress", text: "Reading the attach path.", mergeKey: "read", mergedText: "Reading {n} files." },
      },
      {
        id: "b5",
        after: 1400,
        block: {
          kind: "files",
          title: "Read",
          items: [
            { path: "src/client/src/realtime/socket.ts", note: "retry with backoff, resumes on visibility" },
            { path: "src/server/realtime/hub.ts", note: "drops the subscription on socket close" },
            { path: "src/server/sessiond/attach.ts", note: "assumes the subscription still exists" },
          ],
        },
      },
      {
        id: "b6",
        after: 2400,
        block: {
          kind: "say",
          text: "The client does come back: it retries with backoff and resumes on the visibility event. The server unsubscribes the session the moment the socket closes, so the reattach lands on a subscription that is already gone and the replay buffer is empty.",
        },
        say: {
          type: "signpost",
          text: "Found it. Your phone does come back. By then the server has thrown the subscription away. The detail is on screen.",
        },
      },
      {
        id: "b7",
        after: 1100,
        activity: "running the realtime tests",
        block: { kind: "tool", name: "run", target: "npm test -- realtime", meta: "3 tests" },
        say: { type: "orient", text: "Running the realtime tests so we can watch it fail." },
      },
      {
        id: "b8",
        after: 9000,
        block: {
          kind: "table",
          title: "npm test -- realtime",
          columns: ["test", "result"],
          rows: [
            ["reattaches after sleep", "fail"],
            ["keeps queued prompts across sleep", "fail"],
            ["drops stale sockets", "pass"],
          ],
        },
        say: { type: "signpost", text: "Two of the three fail, and they fail the way I expected. The table is on screen." },
      },
      {
        id: "b9",
        after: 2200,
        block: {
          kind: "diff",
          file: "src/server/realtime/hub.ts",
          hunks: [
            { sign: " ", text: "  onSocketClose(sessionId) {" },
            { sign: "-", text: "    this.subscriptions.delete(sessionId);" },
            { sign: "+", text: "    this.subscriptions.get(sessionId)?.hold(GRACE_MS);" },
            { sign: " ", text: "  }" },
          ],
        },
        say: { type: "signpost", text: "The change itself is four lines. It is on screen." },
      },
      {
        id: "b10",
        after: 1600,
        block: {
          kind: "question",
          text: "Which fix should I take?",
          options: [
            { id: "hold", label: "Hold the subscription", detail: "Server keeps it alive for thirty seconds after the socket closes." },
            { id: "replay", label: "Replay on attach", detail: "Client asks for everything it missed when it comes back." },
          ],
        },
        say: {
          type: "decision",
          text: "Two ways to go. Hold the subscription open for half a minute, or replay whatever you missed when you come back. Which one?",
        },
        wait: true,
        answers: {
          hold: {
            block: { kind: "say", text: "Holding the subscription. Thirty second grace, cleared on a real detach." },
            say: { type: "reply", text: "Holding it. That is the smaller change." },
          },
          replay: {
            block: { kind: "say", text: "Replaying on attach. The client will ask for everything after its last sequence number." },
            say: { type: "reply", text: "Replay it is. That one is bigger, but it also survives a server restart." },
          },
        },
      },
      {
        id: "b11",
        after: 1200,
        activity: "running the tests again",
        block: { kind: "tool", name: "run", target: "npm test -- realtime", meta: "3 tests" },
      },
      {
        id: "b12",
        after: 6500,
        block: {
          kind: "table",
          title: "npm test -- realtime",
          columns: ["test", "result"],
          rows: [
            ["reattaches after sleep", "pass"],
            ["keeps queued prompts across sleep", "pass"],
            ["drops stale sockets", "pass"],
          ],
        },
      },
      {
        id: "b13",
        after: 900,
        block: {
          kind: "answer",
          text: "The session survives sleep now.",
          bullets: [
            "The server holds the subscription for thirty seconds instead of dropping it on close.",
            "Queued prompts replay from the hold buffer on reattach.",
            "All three realtime tests pass. Nothing else changed.",
          ],
        },
        say: { type: "land", text: "Done. All three pass. The summary is on screen when you want it." },
      },
    ],
  },
  {
    id: "triage",
    title: "Morning triage",
    summary: "Fast, noisy stream. Watch what the voice drops.",
    opening: "Main is red. Tell me what broke overnight.",
    steps: [
      {
        id: "t1",
        after: 500,
        block: { kind: "tool", name: "fetch", target: "gh run list --branch main --limit 20" },
        say: { type: "orient", text: "Pulling last night's runs." },
      },
      {
        id: "t2",
        after: 700,
        block: { kind: "tool", name: "read", target: "logs/build-3391.txt", meta: "1.2 MB" },
        say: { type: "progress", text: "Reading a log.", mergeKey: "log", mergedText: "Reading {n} logs." },
      },
      { id: "t3", after: 320, block: { kind: "tool", name: "read", target: "logs/build-3392.txt", meta: "1.1 MB" }, say: { type: "progress", text: "Reading a log.", mergeKey: "log", mergedText: "Reading {n} logs." } },
      { id: "t4", after: 300, block: { kind: "tool", name: "read", target: "logs/build-3393.txt", meta: "980 KB" }, say: { type: "progress", text: "Reading a log.", mergeKey: "log", mergedText: "Reading {n} logs." } },
      { id: "t5", after: 280, block: { kind: "tool", name: "read", target: "logs/build-3394.txt", meta: "1.4 MB" }, say: { type: "progress", text: "Reading a log.", mergeKey: "log", mergedText: "Reading {n} logs." } },
      { id: "t6", after: 260, block: { kind: "tool", name: "read", target: "logs/build-3395.txt", meta: "1.1 MB" }, say: { type: "progress", text: "Reading a log.", mergeKey: "log", mergedText: "Reading {n} logs." } },
      {
        id: "t7",
        after: 1500,
        block: {
          kind: "table",
          title: "Failures since midnight",
          columns: ["job", "count", "first seen"],
          rows: [
            ["e2e: session resume", "6", "01:12"],
            ["unit: prompt queue", "2", "03:40"],
            ["lint", "1", "05:02"],
          ],
        },
        say: { type: "signpost", text: "Nine failures, but really only three problems. The breakdown is on screen." },
      },
      {
        id: "t8",
        after: 2100,
        block: {
          kind: "error",
          title: "e2e: session resume",
          text: "TimeoutError: waiting for selector `[data-turn=\"settled\"]` failed: timeout 5000ms exceeded\n  at resumeSession (tests/e2e/resume.spec.ts:88:5)",
        },
        say: { type: "signpost", text: "Six of them are the same timeout in one end to end test. It started just after one in the morning." },
      },
      {
        id: "t9",
        after: 1800,
        block: {
          kind: "say",
          text: "The commit before the first failure is 4a3b7c9, which moved promoted tabs into the sessiond catalog. The e2e test still waits on the old selector, so this is very likely a stale test rather than a broken app.",
        },
        say: { type: "signpost", text: "One commit lines up with the start. It looks like a stale test, not a broken app." },
      },
      {
        id: "t10",
        after: 1500,
        block: {
          kind: "question",
          text: "What now?",
          options: [
            { id: "fix", label: "Fix the test now", detail: "Update the selector and rerun the suite." },
            { id: "file", label: "File it and move on", detail: "Open an issue with the run links, keep main red." },
          ],
        },
        say: { type: "decision", text: "I can fix the test now, or write it up and leave it. Which?" },
        wait: true,
        answers: {
          fix: {
            block: { kind: "say", text: "Fixing the selector and rerunning the suite." },
            say: { type: "reply", text: "Fixing it now." },
          },
          file: {
            block: { kind: "say", text: "Filed with links to all six runs and the suspect commit." },
            say: { type: "reply", text: "Filed. Main stays red until someone picks it up." },
          },
        },
      },
      {
        id: "t11",
        after: 1400,
        block: {
          kind: "answer",
          text: "Overnight, in one line: one stale test, one real queue bug, one lint slip.",
          bullets: [
            "Six e2e failures trace to one selector left behind by the tabs change.",
            "Two prompt queue failures are new and look real.",
            "One lint failure is a missing changeset.",
          ],
        },
        say: { type: "land", text: "That is the night. The queue bug is the only one I would call real." },
      },
    ],
  },
];

export function sessionById(id) {
  return SESSIONS.find((session) => session.id === id) ?? SESSIONS[0];
}
