// Separate dev-only entry point. This preview has no transport or network data.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { ForgerieDictationAdapter } from "../src/speech/ForgerieDictationAdapter";
import { DictationProvider } from "../src/DictationProvider";

import type { PendingAsk } from "../src/contracts";
import type { CommandBinding } from "../src/ui/SlashCommands";
import type { MentionSource } from "../src/mentionSource";
import "../src/ui/theme.css";
import { createAttachmentAdapter } from "../src/attachments";

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
const scenarioAsk: Record<string, PendingAsk> = { ask: planAsk, "ask-long": longAsk, "ask-reconnecting": planAsk, "mentions-ask": planAsk, "slash-ask": planAsk, "attachments-ask": planAsk };
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
const scenarios: Record<string, TranscriptMessage[]> = {
  empty: [], loading: [], stress: stressMessages, tools: toolMessages(false), "tools-running": toolMessages(true),
  "chain-of-thought": chainMessages(false), "chain-of-thought-running": chainMessages(true),
  "streamdown-live": [], "streamdown-running": streamdownMessages(streamdownFrames[1]!),
  ...scenario === "images" || scenario === "images-viewer" ? { images: imageMessages(), "images-viewer": imageMessages() } : {},
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
  const [running, setRunning] = useState(scenario === "running" || scenario === "tools-running" || scenario === "chain-of-thought-running" || scenario === "reconnecting-running" || scenario === "streamdown-running");
  useEffect(() => {
    if (scenario !== "streamdown-live" || !running) return;
    const timers = streamdownFrames.slice(1).map((text, index) => setTimeout(() => {
      setMessages((current) => current.map((message) => message.id === "markdown-answer" ? say(message.id, "assistant", text) : message));
      if (index === streamdownFrames.length - 2) setRunning(false);
    }, (index + 1) * 1500));
    return () => timers.forEach(clearTimeout);
  }, [running]);
  const recovering = scenario === "reconnecting" || scenario === "reconnecting-running" || scenario === "ask-reconnecting";
  const [ask, setAsk] = useState<PendingAsk | undefined>(scenarioAsk[scenario]);
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
  async function onNew(message: AppendMessage) {
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    if (scenario === "streamdown-live") {
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
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew, onCancel: async () => setRunning(false),
    adapters: { dictation, ...(attachmentPreview ? { attachments: createAttachmentAdapter(async () => {
      if (scenario === "attachments-error") throw new Error("The workspace is read only. Your file stays here.");
      return { path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 };
    }) } : {}) },
    isRunning: running, isLoading: scenario === "loading", isDisabled: scenario === "loading" || scenario === "disconnected" || recovering });
  useEffect(() => {
    if (scenario === "slash-capture") {
      runtime.thread.composer.setText("/");
      document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
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
    const query = new URLSearchParams(location.search).get("mention");
    if (!scenario.startsWith("mentions") || query === null) return;
    const timer = setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]');
      if (!input) return;
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 100);
    return () => clearTimeout(timer);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <DictationProvider adapter={dictation}>
    <SessionFrame name="Session client" status={scenario === "loading" ? "Connecting" : recovering ? "Reconnecting" : scenario === "disconnected" ? "Disconnected" : running ? "Running" : ask ? "Waiting for you" : "Connected"}
      error={recovering ? "Reconnecting automatically. Your draft stays here." : scenario === "disconnected" ? "Session unavailable. Reload to try again." : undefined}
      recovery={scenario === "disconnected" ? <button onClick={() => location.reload()}>Reload</button> : undefined}>
      <Thread commands={scenario.startsWith("slash") || scenario.startsWith("mentions") ? previewCommands : undefined} mentions={scenario.startsWith("mentions") ? previewMentions : undefined} ask={ask && { ask, phase: { type: "answering" }, offline: recovering,
        onSubmit: () => setAsk(undefined), onDismiss: () => setAsk(undefined),
        onChat: async (text) => { setAsk(undefined); exchange(text); } }} />
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
const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
