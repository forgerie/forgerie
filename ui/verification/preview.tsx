// Separate dev-only entry point. This preview has no transport or network data.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime } from "@assistant-ui/react";
import type { QueuedMessage } from "../src/queue";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { ForgerieDictationAdapter } from "../src/speech/ForgerieDictationAdapter";
import { DictationProvider } from "../src/DictationProvider";

import type { PendingAsk, PendingDialog, SessionModel } from "../src/contracts";
import type { DialogPhase } from "../src/dialog";
import type { CommandBinding } from "../src/ui/SlashCommands";
import type { MentionSource } from "../src/mentionSource";
import "../src/ui/theme.css";
import { NewSession, type LaunchDraft } from "../src/NewSession";
import { createLaunchStore } from "../src/launches";
import { createDeferredFiles, type NewSessionApi, type Project, type Workspace } from "../src/newSession";
import { createAttachmentAdapter } from "../src/attachments";
import { attachmentDelivery } from "../src/attachmentDelivery";
import { idleCompaction, isCompactCommand, type CompactionState } from "../src/compaction";
import { SessionDoorsProvider } from "../src/ui/SessionDoor";
import type { HandoffDoor } from "../src/handoffDoor";
import type { ShellResult, ShellRun } from "../src/shellRun";
import type { ComposerInputElement } from "../src/ui/ComposerEditor";

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const tool = (id: string, name: string, args: unknown, state: ToolState): TranscriptPart => ({ type: "tool", id, name, args, state });
const done = (output: string, isError = false): ToolState => ({ type: "done", output, isError });

const initialMessages: TranscriptMessage[] = [
  say("question", "user", "Show the smallest session client."),
  say("answer", "assistant",
    "## Keep the Pi connection\n\nThe existing store handles **history and streaming**. Bind the new view to the same runtime.\n\n```ts\nconst runtime = useExternalStoreRuntime({\n  messages, convertMessage, onNew,\n});\n```\n\n| Part | Responsibility |\n| --- | --- |\n| Store | Pi connection |\n| Thread | Messages and composer |\n\nNo backend changes are needed."),
];
const stressMessages: TranscriptMessage[] = [initialMessages[0]!, say("answer", "assistant",
  `## Long content\n\nhttps://example.test/${"long-segment/".repeat(30)}\n\n\`\`\`ts\nconst path = '${"directory/".repeat(40)}';\n\`\`\`\n\n| One | Two | Three | Four | Five | Six |\n| --- | --- | --- | --- | --- | --- |\n| Value | Value | Value | Value | Value | Value |`)];
const streamdownMessages = (text: string): TranscriptMessage[] => [
  say("markdown-question", "user", "Show the streaming Markdown renderer."), say("markdown-answer", "assistant", text),
];
const streamdownFrames = [
  "An **unfinished",
  "An **unfinished phrase**.\n\n```ts\nconst count =",
  "An **unfinished phrase**.\n\n```ts\nconst count = 1;\n```\n\n| Part | State |\n| --- | --- |\n| Code | Ready |\n\nRead [the guide](https://example.test/unfinished",
  "An **unfinished phrase**.\n\n```ts\nconst count = 1;\n```\n\n| Part | State |\n| --- | --- |\n| Code | Ready |\n\nRead [the guide](https://example.test/complete).\n\n![Diagram](https://example.test/diagram.png)",
];
const testOutput = Array.from({ length: 40 }, (_, index) => ` ✓ src/transcript.test.ts > case ${index + 1} (${index % 7 + 1} ms)`).join("\n");
// A coding turn: reasoning, a group of reads, a failed command, an edit, and the answer.
const toolMessages = (running: boolean): TranscriptMessage[] => [
  say("q", "user", "Why does the reply show a stuck tool row?"),
  { id: "a1", role: "assistant", parts: [
    { type: "thinking", text: "The **tool.start** event may arrive before `message.end`. Check how the transcript matches call ids." },
    { type: "text", text: "I'll read the reducer and its tests first." },
    tool("r1", "read", { path: "src/transcript.ts" }, done("export function reduceEvent(state, event) {\n  switch (event.type) {\n    // …\n  }\n}")),
    tool("r2", "read", { path: "src/transcript.test.ts" }, done("describe(\"tool executions\", () => { … })")),
    tool("g1", "bash", { command: `grep -rn "toolCallId" src --include=*.ts | head -40 # ${"very-long-argument ".repeat(6)}` }, done("src/transcript.ts:12: toolCallId")),
  ] },
  { id: "a2", role: "assistant", parts: [
    tool("f1", "bash", { command: "npm test -- transcript" }, done("Error: expected 1 execution, received 2\n    at transcript.test.ts:88:5", true)),
    { type: "text", text: "The test confirms two executions for one call. I'll match on the call id in both directions." },
    tool("e1", "edit", { path: "src/transcript.ts", edits: [{ oldText: "a", newText: "b" }] }, done("Successfully replaced 1 block(s) in src/transcript.ts.")),
  ] },
  { id: "a3", role: "assistant", parts: running
    ? [tool("t1", "bash", { command: "npm test" }, { type: "running", output: testOutput })]
    : [tool("t1", "bash", { command: "npm test" }, done(testOutput)),
      { type: "text", text: "Fixed. `tool.start` now advances the execution that `message.end` created, so each call shows **one** line." }] },
];

// One continuous activity block, including a failure visible while another tool runs.
const chainMessages = (running: boolean): TranscriptMessage[] => [
  say("chain-q", "user", "Check the session client before shipping."),
  { id: "chain-a", role: "assistant", parts: [
    { type: "thinking", text: "Read the **session store** and its tests before checking the build." },
    tool("chain-read", "read", { path: "src/sessionStore.ts" }, done("export function createSessionStore(session) { /* … */ }")),
    tool("chain-tests", "read", { path: "src/sessionStore.test.ts" }, done("describe(\"session recovery\", () => { /* … */ })")),
    { type: "thinking", text: "The recovery tests cover retained message identity. Run the focused checks, then the complete suite." },
    tool("chain-fail", "bash", { command: "npm test -- missing.test.ts" }, done("No test files found. Check the test path.", true)),
    tool("chain-run", "bash", { command: "npm test" }, running ? { type: "running", output: testOutput } : done(testOutput)),
    ...running ? [] : [{ type: "text" as const, text: "The suite passed. The earlier command used the wrong test path. No server or model settings changed." }],
  ] },
];

// Skill records: a typed invocation, a batch of loads beside other tools, a load with no argument, and a failed load.
const skillDoc = (name: string) => `---\nname: ${name}\ndescription: Guidance the agent loads before it writes or changes code.\n---\n\n# ${name}\n\n${"Use short sentences. Name the cost of each choice. ".repeat(8)}`;
const skillMessages = (running: boolean): TranscriptMessage[] => [
  { id: "skill-q", role: "user", skill: { name: "handoff", location: "/home/me/code/forgerie/skills/handoff/SKILL.md",
    content: `References are relative to /home/me/code/forgerie/skills/handoff.\n\n# Handoff\n\nCall \`handoff_session\` immediately. Do not summarize the conversation, inspect files, write a handoff document, or do any other preparation in this session.\n\n${"The destination session owns all context preparation. ".repeat(6)}` },
  parts: [{ type: "text", text: "Sending while working: follow-up queue, steering, showing and clearing queued messages, and restoring queued prompts after Stop." }] },
  { id: "skill-a", role: "assistant", parts: [
    { type: "thinking", text: "Load the writing and engineering guidance before planning." },
    tool("sk-1", "read", { path: "/home/me/.agents/skills/simple-english/SKILL.md" }, done(skillDoc("simple-english"))),
    tool("sk-2", "read", { path: "/home/me/.agents/skills/unslop/SKILL.md" }, done(skillDoc("unslop"))),
    tool("sk-3", "read", { path: "/home/me/.pi/packages/pi-bedrock-principals/skills/bedrock-principles/SKILL.md" },
      running ? { type: "running", output: "" } : done(skillDoc("bedrock-principles"))),
    ...running ? [] : [tool("sk-git", "bash", { command: "git status --short" }, done(" M src/transcript.ts")),
      { type: "text" as const, text: "The queue already exists on the server. I'll read the session store next." }],
  ] },
  ...running ? [] : [
    { id: "skill-q2", role: "user" as const, skill: { name: "testing-guide", location: "/home/me/code/forgerie/.agents/skills/testing-guide/SKILL.md", content: skillDoc("testing-guide") }, parts: [] },
    { id: "skill-a2", role: "assistant" as const, parts: [
      tool("sk-4", "read", { path: "/home/me/.agents/skills/a-skill-name-that-is-much-longer-than-any-pane-is-wide/SKILL.md" },
        done("ENOENT: no such file or directory, access '/home/me/.agents/skills/a-skill-name-that-is-much-longer-than-any-pane-is-wide/SKILL.md'", true)),
      { type: "text" as const, text: "That skill is not installed. I'll follow the repository testing guide instead." },
    ] },
  ],
];

const planAsk: PendingAsk = { askId: "plan", askedAt: "2026-09-29T00:00:00Z", questions: [
  { id: "store", question: "Where should session drafts be kept?", detail: "Both survive a reconnect. Only storage survives a reload.", options: [
    { value: "memory", label: "In memory", detail: "Lost on reload. No new storage." },
    { value: "local", label: "Local storage", detail: "Survives reload on this browser only." },
    { value: "server", label: "On the server", detail: "Follows you across devices. Needs a new endpoint." }] },
  { id: "checks", question: "Which checks should run before each commit?", multiple: true, options: [
    { value: "lint", label: "Lint" }, { value: "types", label: "Typecheck" }, { value: "tests", label: "Unit tests" }] },
  { id: "name", question: "What should the new module be called?", options: [] },
] };
const longAsk: PendingAsk = { askId: "long", askedAt: "2026-09-29T00:00:00Z", questions: [
  { id: "target", question: `Which deployment target should this change ship to first, given that ${"the staging cluster and the edge fleet both run the old build ".repeat(2)}?`,
    detail: "The edge fleet updates overnight. Staging updates on every merge. ".repeat(3),
    options: Array.from({ length: 12 }, (_, index) => ({ value: `t${index}`, label: `Region ${index + 1}: ${["us-east", "eu-west", "ap-south"][index % 3]}-${index + 1}`,
      ...(index % 4 === 0 ? { detail: "Canary traffic only for the first hour." } : {}) })) },
] };
const scenario = new URLSearchParams(location.search).get("scenario") ?? "history";
const scenarioAsk: Record<string, PendingAsk> = { "dialog-ask": planAsk, "shell-ask": planAsk, ask: planAsk, "ask-long": longAsk, "ask-reconnecting": planAsk, "mentions-ask": planAsk, "slash-ask": planAsk, "attachments-ask": planAsk, "compaction-ask": planAsk };
const mentionFiles = ["src/main.ts", "src/file with spaces.ts", "src/ui/Composer.tsx", "vendor/", "dir with space/",
  ...Array.from({ length: 9 }, (_, i) => `src/very-long-folder-name-${i}/nested-folder/mention-source-${i}.test.ts`)];
const previewMentions: MentionSource = {
  key: "preview",
  files: async (query) => {
    if (query === "error") throw new Error("File suggestions unavailable. Edit the query to try again.");
    return mentionFiles.filter((path) => path.toLowerCase().includes(query.toLowerCase())).slice(0, 12)
      .map((path) => ({ id: path, type: "file", label: path, description: "tracked" }));
  },
  models: async (query) => Array.from({ length: 12 }, (_, i) => ({ id: `provider/model-${i}`, type: "model", label: `provider/model-${i}`,
    description: `Coding model ${i}` })).filter((item) => item.id.includes(query)),
};
const pixel = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAMElEQVR4nGMwTVxNEjp+5SlJiGHUglELRi0YtWDUglELRi0YtWDUglELRi0YKhYAANtngmqrX9EgAAAAAElFTkSuQmCC";
const attachmentPreview = scenario.startsWith("attachments");
/** A labelled stand-in screenshot, drawn locally so the preview needs no files. */
function screenshot(label: string, hue: number, width = 1280, height = 800): string {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue} 45% 82%)`); gradient.addColorStop(1, `hsl(${hue + 40} 40% 55%)`);
  context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  context.fillStyle = "rgb(255 255 255 / 0.85)";
  context.fillRect(width * 0.08, height * 0.12, width * 0.84, height * 0.12);
  for (let row = 0; row < 4; row++) context.fillRect(width * 0.08, height * (0.32 + row * 0.14), width * (0.84 - row * 0.12), height * 0.08);
  context.fillStyle = "rgb(20 20 20 / 0.8)";
  context.font = `600 ${Math.round(height / 12)}px sans-serif`;
  context.fillText(label, width * 0.11, height * 0.205);
  return canvas.toDataURL("image/png");
}
const imageMessages = (): TranscriptMessage[] => {
  const postures = ["Unfolded portrait", "Unfolded landscape", "Folded portrait", "Folded landscape", "Dark theme", "Light theme", "Ask mode"];
  // The gallery that overflows comes last, so a capture at the bottom shows it.
  return [
    say("img-q2", "user", "Show only the folded portrait capture."),
    { id: "img-a2", role: "assistant", parts: [
      tool("shot-single", "read", { path: "verification/local/shots/folded-portrait.png" },
        { type: "done", output: "Read image file [image/png]\n[image]", isError: false, images: [screenshot("Folded portrait", 200, 950, 1276)] }),
      { type: "text", text: "Here it is." },
    ] },
    { id: "img-q", role: "user", parts: [{ type: "text", text: "Compare these two layouts." }], attachments: [
      { id: "img-before", type: "image", name: "before.png", contentType: "image/png", status: { type: "complete" }, content: [{ type: "image", image: screenshot("Before", 20, 900, 1200) }] },
      { id: "img-after", type: "image", name: "after.png", contentType: "image/png", status: { type: "complete" }, content: [{ type: "image", image: screenshot("After", 140, 900, 1200) }] },
    ] },
    { id: "img-a", role: "assistant", parts: [
      { type: "thinking", text: "Capture every posture, then compare the composer position." },
      ...postures.map((label, index) => tool(`shot-${index}`, "read", { path: `verification/local/shots/${label.toLowerCase().replaceAll(" ", "-")}.png` },
        { type: "done", output: "Read image file [image/png]\n[image]", isError: false, images: [screenshot(label, index * 45)] })),
      { type: "text", text: "The composer stays inside every posture. The folded landscape capture is the tightest: the bar keeps all four actions." },
    ] },
  ];
};
// Turns that created sessions: a handoff here, a spawn in another workspace,
// and a failed handoff, which earns no door.
const previewCwd = "/home/simon/code/forgerie";
const handoffMessages: TranscriptMessage[] = [
  say("handoff-q", "user", "Hand off the next slice to a fresh session."),
  { id: "handoff-a", role: "assistant", parts: [
    { type: "thinking", text: "The user asked for a detached handoff. Pass their words as the focus." },
    tool("handoff-call", "handoff_session", { focus: "Handoff navigation: A direct link from a handoff/spawn result to its destination session." },
      { type: "done", output: "Started detached handoff b7443b44. Destination session 01a0f7f2 is preparing in /home/simon/code/forgerie.", isError: false,
        door: { sessionId: "01a0f7f2", cwd: previewCwd } }),
  ] },
  say("spawn-q", "user", "Start an independent audit of the documentation site."),
  { id: "spawn-a", role: "assistant", parts: [
    tool("spawn-read", "read", { path: "docs/README.md" }, done("# Documentation")),
    tool("spawn-call", "spawn_session", { prompt: "Audit every page for broken links and stale commands. Report each page with its fix.", cwd: "/home/simon/code/forgerie-documentation-site" },
      { type: "done", output: "Started independent session 01a0f801 in /home/simon/code/forgerie-documentation-site.", isError: false,
        door: { sessionId: "01a0f801", cwd: "/home/simon/code/forgerie-documentation-site" } }),
    { type: "text", text: "The audit runs in its own session. Open it from the line above." },
  ] },
  say("failed-q", "user", "Hand off again with the old model."),
  { id: "failed-a", role: "assistant", parts: [
    { type: "thinking", text: "Use the model the user named." },
    tool("failed-call", "handoff_session", { focus: "Retry", model: "provider/retired-model" }, done("Model provider/retired-model is not available.", true)),
    { type: "text", text: "The handoff failed because that model is not available. No session was created." },
  ] },
];
// Model and thinking level: a catalog shaped like a real Pi profile, local only.
const previewModels: SessionModel[] = [
  { provider: "cliproxyapi", id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash", contextWindow: 1_048_576, reasoning: true, scoped: true },
  { provider: "cliproxyapi", id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (OpenRouter)", contextWindow: 1_048_576, reasoning: true, scoped: true },
  { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true, scoped: true },
  { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272_000, reasoning: true, scoped: true },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", contextWindow: 200_000, reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000, reasoning: true },
  { provider: "openai-codex", id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextWindow: 272_000, reasoning: true },
  { provider: "openrouter", id: "qwen-4-coder-480b-a35b-instruct-long-context-preview", name: "Qwen 4 Coder 480B A35B Instruct Long Context Preview", contextWindow: 262_144, reasoning: false },
  ...Array.from({ length: 12 }, (_, index): SessionModel => ({ provider: "openrouter", id: `model-${index + 1}`, name: `OpenRouter model ${index + 1}`, contextWindow: 131_072, reasoning: index % 3 !== 0 })),
];
const previewLevels = (model: SessionModel | undefined) => model?.reasoning ? ["minimal", "low", "medium", "high", "xhigh", "max"] : ["off"];
// Extension dialogs, as the daemon lists them: oldest first, local only.
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const previewConfirm: PendingDialog = { dialogId: "confirm", kind: "confirm", title: "Run the database migration on staging?",
  message: "The guard extension stopped this bash call: it changes a shared database. Choose Yes to let it run, or No to block it. The agent sees your choice.",
  askedAt: "2026-10-05T12:00:00Z", timeoutAt: inSeconds(272) };
const previewSelect: PendingDialog = { dialogId: "select", kind: "select", title: "Which environment should the deploy extension target?",
  options: ["staging", "production", "preview-branch-for-the-session-picker-redesign", "local", "canary (5% of traffic)", "nowhere"], askedAt: "2026-10-05T12:00:01Z" };
const previewInput: PendingDialog = { dialogId: "input", kind: "input", title: "Name the release tag", placeholder: "v1.2.3", askedAt: "2026-10-05T12:00:02Z" };
const dialogScenarios: Record<string, PendingDialog[]> = {
  "dialog-confirm": [previewConfirm], "dialog-select": [previewSelect], "dialog-input": [previewInput],
  "dialog-many": [previewConfirm, previewSelect, previewInput], "dialog-ask": [previewInput], "dialog-error": [previewSelect],
};
const modelStart: Record<string, { model: SessionModel; level: string }> = {
  "model-plain": { model: previewModels[8]!, level: "off" },
  "model-long": { model: previewModels[1]!, level: "xhigh" },
};
/** The preview cannot navigate, so it records which session a door opened. */
const openPreviewDoor = (door: HandoffDoor) => { document.documentElement.dataset["openedSession"] = door.sessionId; };
const compactionPreview = scenario.startsWith("compaction");
// Sending while working: Pi's queue as status reports it, in delivery order.
const queuePreview = scenario.startsWith("queue");
const queueScenarios: Record<string, QueuedMessage[]> = {
  queue: [{ kind: "steer", text: "Use the existing retry helper instead of writing a new one." },
    { kind: "followUp", text: "After this, add tests for the reconnect path and run the full suite." },
    { kind: "followUp", text: `Then update the verification notes. ${"Keep the wording short and name each check that ran. ".repeat(4)}` }],
  "queue-compaction": [{ kind: "followUp", text: "Summarize what changed for the release notes." },
    { kind: "followUp", text: "/compact keep the release decisions and the test plan" }],
  "compaction-queued": [{ kind: "followUp", text: "Another window queued this follow-up." },
    { kind: "followUp", text: "/compact retain the test plan, release decisions, and deployment notes" }],
  "compaction-reconnecting": [{ kind: "followUp", text: "/compact retain the deployment decisions" }],
};
const queueDrafts: Record<string, string> = { queue: "Also check the folded landscape layout.", "queue-compaction": "Then open a pull request.",
  "queue-attachments": "Review this screenshot after the run.", "queue-attachments-folder": "Review this screenshot after the run." };
// The page's delivery choice persists, so each attachment scenario sets the one it shows.
const queueAttachmentPreview = scenario.startsWith("queue-attachments");
if (queueAttachmentPreview) attachmentDelivery.set(scenario === "queue-attachments-folder" ? "folder" : "inline");
const compactionSummary = "Compaction complete.\nTokens before: 84,120\n\nThe session keeps its deployment decisions and test plan.\n" + "Keep the runtime server-owned and do not retry mutations. ".repeat(30);
const compactionScenarios: Record<string, CompactionState> = {
  "compaction-queued": { type: "queued", text: "/compact retain the test plan, release decisions, and deployment notes" },
  "compaction-running": { type: "running" },
  "compaction-complete": { type: "finished", outcome: "complete", message: compactionSummary },
  "compaction-error": { type: "finished", outcome: "failed", message: "Compaction failed: The provider is unavailable. Try again after the provider recovers." },
  "compaction-reconnecting": { type: "queued", text: "/compact retain the deployment decisions" },
  "queue-compaction": { type: "queued", text: "/compact keep the release decisions and the test plan" },
};
const shellPreview = scenario.startsWith("shell");
const shellRow = (id: string, run: ShellRun): TranscriptMessage => ({ id, role: "shell", parts: [{ type: "shell", run }] });
const shellDone = (output: string, exitCode: number, extra: Partial<Extract<ShellResult, { type: "done" }>> = {}): ShellResult =>
  ({ type: "done", output, exitCode, cancelled: false, truncated: false, ...extra });
const gitLog = Array.from({ length: 30 }, (_, index) => `${(0x9c1a3e + index * 4099).toString(16)} feat(ui): change number ${index + 1} to the session client`).join("\n");
const shellMessages = (live: boolean): TranscriptMessage[] => [
  say("shell-q", "user", "Check the branch before we commit."),
  say("shell-a", "assistant", "Run `git status` and the focused tests yourself, so the output stays visible here."),
  shellRow("shell-1", { command: "git status --short", excludeFromContext: false, result: shellDone(" M src/sessionStore.ts\n M src/transcript.ts\n?? src/shellRun.ts\n", 0) }),
  shellRow("shell-2", { command: "true", excludeFromContext: false, result: shellDone("", 0) }),
  shellRow("shell-3", { command: `npm test -- --run src/transcript.shell.test.ts src/sessionStore.shell.test.ts ${"--reporter=verbose ".repeat(3)}`, excludeFromContext: true,
    result: shellDone("FAIL src/sessionStore.shell.test.ts > blocks a second command\nAssertionError: expected 'ready' to be 'blocked'\n", 1,
      { truncated: true, fullOutputPath: "/tmp/pi-bash-6f1c2e8a9b7d4c3e2f1a0b9c8d7e6f5a4b3c2d1e.log" }) }),
  shellRow("shell-4", { command: "make deploy", excludeFromContext: false, result: { type: "failed", output: "", error: "spawn /bin/bash ENOENT" } }),
  shellRow("shell-5", { command: "git log --oneline -30", excludeFromContext: false,
    result: live ? { type: "running", output: gitLog.split("\n").slice(0, 12).join("\n") + "\n" } : shellDone(`${gitLog}\n`, 0) }),
];
const summaryText = ["## Goal", "- Make the session picker show which sessions wait for a reply.",
  "- Keep the picker readable on the folded cover screen.", "", "## Constraints & Preferences",
  ...Array.from({ length: 14 }, (_, index) => `- Constraint ${index + 1}: keep each change small, typed, and covered by a test before it lands on \`main\`.`),
  "", "## Progress", "### Done", ...Array.from({ length: 18 }, (_, index) => `- [x] Step ${index + 1} landed with its test and a posture capture.`),
  "", "### Next", "- Measure the Tab Ultra 11 viewport.", "", "```ts", "const waiting = sessions.filter((session) => session.needsReply);", "```"].join("\n");
// A compaction seam and a branch summary between turns. `summary-open` opens the compaction and scrolls it to the top.
const summaryMessages: TranscriptMessage[] = [
  say("before-q", "user", "Plan the picker change."), say("before-a", "assistant", "The picker reads `needsReply` from the status read."),
  { id: "compacted", role: "system", summary: "compaction", parts: [{ type: "text", text: summaryText }] },
  say("after-q", "user", "Continue with the folded layout."),
  say("after-a", "assistant", "The folded layout keeps the second line. I moved the unread dot into the title row."),
  { id: "branch", role: "system", summary: "branch", parts: [{ type: "text", text: "Tried a separate waiting list. It hid sessions the user had pinned." }] },
  say("last-a", "assistant", "Back on the main branch with the dot in the title row."),
];
const scenarios: Record<string, TranscriptMessage[]> = {
  summary: summaryMessages, "summary-open": summaryMessages,
  shell: shellMessages(false), "shell-running": shellMessages(true), "shell-blocked": shellMessages(true),
  "shell-agent": [...shellMessages(false), ...toolMessages(true).slice(0, 2)], "shell-ask": shellMessages(false),
  empty: [], loading: [], stress: stressMessages, tools: toolMessages(false), "tools-running": toolMessages(true),
  "chain-of-thought": chainMessages(false), "chain-of-thought-running": chainMessages(true),
  skills: skillMessages(false), "skills-open": skillMessages(false), "skills-invocation": skillMessages(false), "skills-running": skillMessages(true),
  "streamdown-live": [], "streamdown-running": streamdownMessages(streamdownFrames[1]!),
  ...scenario === "images" || scenario === "images-viewer" ? { images: imageMessages(), "images-viewer": imageMessages() } : {},
  handoff: handoffMessages, "handoff-open": handoffMessages,
};
function Preview() {
  const [dictation] = useState(() => new ForgerieDictationAdapter({
    ready: async () => {},
    capture: async () => {
      if (scenario === "dictation-error") throw new Error("Microphone permission was denied.");
      return { actualSampleRateHz: 16_000, failure: undefined, endpointWindow: () => new Float32Array(1_600),
        finalize: () => new Float32Array(1_600), synchronize: async () => {}, abort: async () => {},
        stopAndFinalize: async () => new Float32Array(1_600) };
    },
    transcribe: async () => ({ text: "This is a local dictation preview." }),
  }));
  const [messages, setMessages] = useState<TranscriptMessage[]>(scenarios[scenario] ?? initialMessages);
  const [compaction, setCompaction] = useState<CompactionState>(compactionScenarios[scenario] ?? idleCompaction);
  // `skills-open` opens every skill record for screenshots. `skills-invocation`
  // opens the first command and scrolls it to the top of the transcript.
  useEffect(() => {
    if (scenario !== "summary-open") return;
    const timer = setTimeout(() => {
      const row = document.querySelector<HTMLDetailsElement>("details.history-summary");
      if (!row) return;
      row.open = true;
      setTimeout(() => row.scrollIntoView({ block: "start" }), 200);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (scenario !== "skills-open" && scenario !== "skills-invocation") return;
    const timer = setTimeout(() => {
      const selector = scenario === "skills-open" ? ".skill-invocation, details.skill-loads, details.skill-load" : ".skill-invocation";
      const records = [...document.querySelectorAll<HTMLDetailsElement>(selector)];
      for (const details of records) details.open = true;
      if (scenario === "skills-invocation") setTimeout(() => records[0]?.scrollIntoView({ block: "start" }), 200);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  const [queue, setQueue] = useState<QueuedMessage[]>(queueScenarios[scenario] ?? []);
  const [running, setRunning] = useState(queuePreview || scenario === "shell-agent" || scenario === "skills-running" || scenario === "compaction-live" || scenario === "compaction-queued" || scenario === "compaction-running" || scenario === "compaction-reconnecting" || scenario === "running" || scenario === "tools-running" || scenario === "chain-of-thought-running" || scenario === "reconnecting-running" || scenario === "streamdown-running");
  useEffect(() => {
    if (scenario !== "streamdown-live" || !running) return;
    const timers = streamdownFrames.slice(1).map((text, index) => setTimeout(() => {
      setMessages((current) => current.map((message) => message.id === "markdown-answer" ? say(message.id, "assistant", text) : message));
      if (index === streamdownFrames.length - 2) setRunning(false);
    }, (index + 1) * 1500));
    return () => timers.forEach(clearTimeout);
  }, [running]);
  useEffect(() => {
    if (scenario !== "compaction-live" || compaction.type !== "queued") return;
    // Pi takes a compaction off the queue when it starts.
    const timer = setTimeout(() => { setCompaction({ type: "running" }); setQueue((current) => current.filter((item) => !isCompactCommand(item.text))); }, 700);
    return () => clearTimeout(timer);
  }, [compaction]);
  useEffect(() => {
    if (scenario !== "compaction-live" || compaction.type !== "running") return;
    const timer = setTimeout(() => { setCompaction({ type: "finished", outcome: "complete", message: compactionSummary }); setRunning(false); }, 700);
    return () => clearTimeout(timer);
  }, [compaction]);
  // `shell-running` streams the last command's remaining lines, then finishes it.
  useEffect(() => {
    if (scenario !== "shell-running") return;
    const lines = gitLog.split("\n").slice(12);
    const timers = lines.map((line, index) => setTimeout(() => setMessages((current) => current.map((message) => {
      const part = message.parts[0];
      if (message.id !== "shell-5" || part?.type !== "shell") return message;
      const last = index === lines.length - 1;
      const output = `${part.run.result.output}${line}\n`;
      return shellRow(message.id, { ...part.run, result: last ? shellDone(output, 0) : { type: "running", output } });
    })), 400 + index * 250));
    return () => timers.forEach(clearTimeout);
  }, []);
  const shellRunning = messages.some((message) => message.parts[0]?.type === "shell" && message.parts[0].run.result.type === "running");
  const recovering = scenario === "compaction-reconnecting" || scenario === "reconnecting" || scenario === "reconnecting-running" || scenario === "ask-reconnecting";
  const [ask, setAsk] = useState<PendingAsk | undefined>(scenarioAsk[scenario]);
  const [dialogs, setDialogs] = useState<PendingDialog[]>(dialogScenarios[scenario] ?? []);
  const [dialogPhase, setDialogPhase] = useState<DialogPhase>({ type: "answering" });
  // The daemon's side, locally: a close takes a moment, then status drops the dialog.
  const closeDialog = (answer: boolean | string | undefined) => {
    setDialogPhase({ type: "sending" });
    setTimeout(() => {
      if (scenario === "dialog-error" && answer !== undefined) { setDialogPhase({ type: "failed", message: `The extension refused "${String(answer)}". Pick another target.` }); return; }
      document.documentElement.dataset["dialogAnswer"] = JSON.stringify(answer ?? null);
      setDialogs((current) => current.slice(1));
      setDialogPhase({ type: "answering" });
    }, 150);
  };
  // `ask-delayed` opens the ask after load, so a draft can be typed first.
  useEffect(() => {
    if (scenario !== "ask-delayed") return;
    const timer = setTimeout(() => setAsk(planAsk), Number(new URLSearchParams(location.search).get("delay") ?? 1500));
    return () => clearTimeout(timer);
  }, []);
  // `images-viewer` opens the viewer on the second capture for screenshots.
  useEffect(() => {
    if (scenario !== "images-viewer") return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Open unfolded-portrait.png"]')?.click();
      setTimeout(() => document.querySelector("dialog.image-viewer")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })), 50);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  // `handoff-open` expands the first door's call and scrolls to it, so captures
  // show its body beside the button.
  useEffect(() => {
    if (scenario !== "handoff-open") return;
    const timer = setTimeout(() => {
      const call = document.querySelector<HTMLDetailsElement>(".session-door > details");
      if (!call) return;
      call.open = true;
      setTimeout(() => call.closest(".message")?.scrollIntoView({ block: "start" }), 100);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  async function onNew(message: AppendMessage) {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    if (queuePreview && running) {
      // Pi delivers steers before follow-ups.
      setQueue((current) => message.steer ? [...current.filter((item) => item.kind === "steer"), { kind: "steer", text },
        ...current.filter((item) => item.kind !== "steer")] : [...current, { kind: "followUp", text }]);
    } else if (scenario === "streamdown-live") {
      setMessages(streamdownMessages(streamdownFrames[0]!).map((part) => part.role === "user" ? say(part.id, "user", text) : part));
      setRunning(true);
    } else if (attachmentPreview) {
      setAsk(undefined);
      setMessages((current) => [...current, { ...say(`user-${current.length}`, "user", message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")), attachments: [...message.attachments ?? []] },
        say(`reply-${current.length}`, "assistant", "The attachment stayed in this local preview. No prompt was sent to Pi.")]);
    } else exchange(text);
  }
  function exchange(text: string) {
    setMessages((current) => [...current, say(`user-${current.length}`, "user", text),
      say(`reply-${current.length}`, "assistant", "This is a local preview. No prompt was sent to Pi.")]);
  }
  const threadMessages = useThreadMessages(messages, running);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  // Stop returns queued work to the draft in delivery order, ahead of what is typed.
  async function onCancel() {
    const composer = runtimeRef.current?.thread.composer;
    if (composer && queue.length) composer.setText([...queue.map((item) => item.text), composer.getState().text].filter((part) => part.trim()).join("\n\n"));
    setQueue([]);
    setRunning(false);
  }
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew, onCancel,
    adapters: { dictation, ...(attachmentPreview || queueAttachmentPreview ? { attachments: createAttachmentAdapter(async () => {
      if (scenario === "attachments-error") throw new Error("The workspace is read only. Your file stays here.");
      return { path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 };
    }) } : {}) },
    isRunning: running, isLoading: scenario === "loading", isDisabled: scenario === "loading" || scenario === "disconnected" || recovering });
  runtimeRef.current = runtime;
  useEffect(() => {
    const draft = queueDrafts[scenario];
    if (draft !== undefined) runtime.thread.composer.setText(draft);
    if (!queueAttachmentPreview) return;
    const bytes = Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0));
    void runtime.thread.composer.addAttachment(new File([bytes], "layout.png", { type: "image/png" }));
  }, [runtime]);
  const [runtimeChoice, setRuntimeChoice] = useState(() => modelStart[scenario] ?? { model: previewModels[2]!, level: "high" });
  useEffect(() => {
    // Captures need the panel already open; `/model` scenarios type the command instead.
    if (scenario !== "model-open" && scenario !== "model-plain" && scenario !== "model-long") return;
    const timer = setTimeout(() => document.querySelector<HTMLButtonElement>(".model-trigger")?.click(), 150);
    return () => clearTimeout(timer);
  }, []);
  const compactionWaits = compaction.type === "queued" || compaction.type === "running";
  const working = queuePreview || compactionPreview ? { queue: running, steer: running && !compactionWaits } : undefined;
  useEffect(() => {
    if (scenario === "slash-capture") {
      runtime.thread.composer.setText("/");
      document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
    }
    if (!attachmentPreview) return;
    void (async () => {
      const bytes = Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0));
      await runtime.thread.composer.addAttachment(new File([bytes], "sample.png", { type: "image/png" }));
      await runtime.thread.composer.addAttachment(new File(["notes"], "deployment-notes-with-a-long-filename.txt", { type: "text/plain" }));
      runtime.thread.composer.setText("Review these files before changing the deployment.");
      if (scenario === "attachments-error") runtime.thread.composer.send();
    })();
  }, [runtime]);
  useEffect(() => {
    // Only this network-free preview accepts an initial mention query, so the
    // canonical posture script can capture an already-open suggestion list.
    const query = new URLSearchParams(location.search).get("mention") ?? new URLSearchParams(location.search).get("draft");
    if (!scenario.startsWith("mentions") && !shellPreview || query === null) return;
    const timer = setTimeout(() => {
      const input = document.querySelector<ComposerInputElement>('[aria-label="Message"]');
      if (!input) return;
      input.focus();
      input.value = query;
    }, 100);
    return () => clearTimeout(timer);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name="Session client" status={shellRunning && !running ? "Running shell command" : scenario === "loading" ? "Connecting" : recovering ? "Reconnecting" : scenario === "disconnected" ? "Disconnected" : compaction.type === "running" ? "Compacting" : compaction.type === "queued" ? "Compaction queued" : running ? "Running" : ask ? "Waiting for you" : "Connected"}
      error={recovering ? "Reconnecting automatically. Your draft stays here." : scenario === "disconnected" ? "Session unavailable. Reload to try again." : undefined}
      recovery={scenario === "disconnected" ? <button onClick={() => location.reload()}>Reload</button> : undefined}>
      <SessionDoorsProvider cwd={previewCwd} open={openPreviewDoor}>
      <Thread compaction={compactionPreview || queuePreview ? { state: compaction, disabled: recovering,
        onSend: async (text) => { setCompaction({ type: "queued", text }); setQueue((current) => [...current, { kind: "followUp", text }]); },
        onDismiss: () => setCompaction(idleCompaction),
      } : undefined} shell={shellPreview ? {
        availability: shellRunning ? { type: "blocked", reason: "Wait for the running shell command to finish." } : { type: "ready" },
        onRun: async (text) => {
          const excludeFromContext = text.startsWith("!!");
          const command = text.slice(excludeFromContext ? 2 : 1).trim();
          setMessages((current) => [...current, shellRow(`shell-run-${current.length}`, { command, excludeFromContext,
            result: shellDone(`Local preview. Pi did not run "${command}".\n`, 0) })]);
        },
      } : undefined} queue={compactionPreview || queuePreview ? { items: queue, disabled: recovering, onClear: () => {
        setQueue([]);
        if (compaction.type === "queued") setCompaction({ type: "finished", outcome: "cancelled", message: "Queued compaction cancelled." });
      } } : undefined} working={working} dialog={dialogs[0] && { dialog: dialogs[0], count: dialogs.length, phase: dialogPhase,
        offline: recovering || scenario === "disconnected", onAnswer: closeDialog, onCancel: () => closeDialog(undefined) }} model={{ model: runtimeChoice.model, thinkingLevel: runtimeChoice.level, disabled: recovering || scenario === "disconnected",
        listModels: async () => previewModels,
        listThinkingLevels: async () => previewLevels(runtimeChoice.model),
        onModel: async (provider, id) => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (scenario === "model-error") throw new Error(`Model not found: ${provider}/${id}`);
          const model = previewModels.find((item) => item.provider === provider && item.id === id)!;
          setRuntimeChoice((current) => ({ model, level: model.reasoning ? (current.level === "off" ? "medium" : current.level) : "off" }));
        },
        onThinkingLevel: async (level) => { setRuntimeChoice((current) => ({ ...current, level })); },
      }} commands={scenario.startsWith("slash") || scenario.startsWith("mentions") || compactionPreview ? previewCommands : undefined} mentions={scenario.startsWith("mentions") ? previewMentions : undefined} ask={ask && { ask, phase: { type: "answering" }, offline: recovering,
        onSubmit: () => setAsk(undefined), onDismiss: () => setAsk(undefined),
        onChat: async (text) => { setAsk(undefined); exchange(text); } }} />
      </SessionDoorsProvider>
    </SessionFrame>
    </DictationProvider>
  </AssistantRuntimeProvider>;
}
const previewCommands: CommandBinding = { catalog: { type: "ready", commands: [
  { name: "name", source: "builtin", description: "Set session display name" },
  { name: "session", source: "builtin", description: "Show session info and stats" },
  { name: "compact", source: "builtin", description: "Manually compact session context" },
  { name: "reload", source: "builtin", description: "Reload Pi runtime resources for this session" },
  { name: "review", source: "prompt", description: "Review the current changes" },
  { name: "skill:testing", source: "skill", description: "Write regression tests" },
  ...Array.from({ length: 20 }, (_, index) => ({ name: `extension-${index + 1}`, source: "extension" as const, description: "An extension command with a description that wraps in a narrow pane." })),
] }, onRetry: () => {} };
// New session: a local API with real promises and scripted outcomes. No network.
const previewProjects: Project[] = [
  { id: "p1", name: "forgerie", path: "/home/simon/code/sandbox/forgerie" },
  { id: "p2", name: "korri", path: "/home/simon/code/sandbox/korri" },
  { id: "p3", name: "amaze-insights-portal-source-with-a-long-name", path: "/home/simon/code/azure/AmazeInsights/amaze-insights-portal-source-with-a-long-name" },
  ...Array.from({ length: 9 }, (_, index): Project => ({ id: `px${index}`, name: `project-${index + 1}`, path: `/home/simon/code/sandbox/project-${index + 1}` })),
];
const previewWorkspaces: Record<string, Workspace[]> = {
  p1: [{ id: "w1", path: "/home/simon/code/sandbox/forgerie", label: "main", branch: "main", isMain: true },
    { id: "w2", path: "/home/simon/code/sandbox/forgerie/.worktree/new-ui-mvp", label: "new-ui-mvp", branch: "new-ui-mvp", isMain: false },
    { id: "w3", path: "/home/simon/code/sandbox/forgerie/.worktree/session-picker-redesign-with-a-long-branch", label: "redesign", branch: "feat/session-picker-redesign-with-a-long-branch", isMain: false }],
};
const previewNewApi: NewSessionApi = {
  projects: async () => previewProjects,
  workspaces: async (projectId) => previewWorkspaces[projectId] ?? [{ id: `${projectId}-main`, path: previewProjects.find((item) => item.id === projectId)!.path, label: "main", branch: "main", isMain: true }],
  models: async () => ({ models: previewModels, model: previewModels[2], thinkingLevel: "high" }),
  promptResources: async () => [
    { name: "review", source: "prompt", identity: { source: "prompt", name: "review", fingerprint: "p1" }, description: "Review the current changes" },
    { name: "skill:testing", source: "skill", identity: { source: "skill", name: "skill:testing", fingerprint: "s1" }, description: "Write regression tests" },
  ],
  start: async (cwd, first) => {
    const text = typeof first === "string" ? first : first.text;
    const slow = scenario === "new-session-slow" || scenario === "new-session-rapidfire" && text.startsWith("Second");
    await new Promise((resolve) => setTimeout(resolve, slow ? 60_000 : 300));
    if (scenario === "new-session-error" || scenario === "new-session-rapidfire" && text.startsWith("Third")) return { type: "failed", failure: { stage: "start", message: `Folder not found: ${cwd}`, maybeStarted: false } };
    document.documentElement.dataset["started"] = JSON.stringify({ cwd, text });
    return { type: "started", session: { id: "preview-new", cwd } };
  },
};
const previewLaunches = createLaunchStore<LaunchDraft>(previewNewApi);
const previewDeferred = createDeferredFiles();
/** The dialog over a session, as it opens in the app. No network. */
function NewSessionPreview() {
  const [started, setStarted] = useState<string>();
  const [open, setOpen] = useState(true);
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(initialMessages, false), onNew: async () => {} });
  useEffect(() => {
    // Captures need the panel already open, or the launches already listed.
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (scenario === "new-session-destination") timers.push(setTimeout(() => document.querySelector<HTMLButtonElement>(".destination-trigger")?.click(), 400));
    if (scenario === "new-session-rapidfire") {
      for (const [index, text] of ["First: fix the login form", "Second: add the regression tests", "Third: update the changelog"].entries()) {
        timers.push(setTimeout(() => previewLaunches.launch("/home/simon/code/sandbox/forgerie", { text }, {}, { text, attachments: [] }), 200 + index * 50));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name={started ?? "Session client"} status="Connected"><Thread /></SessionFrame>
    {open && <NewSession cwd="/home/simon/code/sandbox/forgerie/.worktree/new-ui-mvp" api={previewNewApi} launches={previewLaunches} deferred={previewDeferred}
      initialMode={scenario === "new-session-rapidfire" ? "rapidfire" : "switch"}
      onStarted={(session) => { setStarted(`Opened ${session.id} in ${session.cwd}`); setOpen(false); }} onClose={() => setOpen(false)} />}
  </AssistantRuntimeProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(scenario.startsWith("new-session") ? <NewSessionPreview /> : <Preview />);
