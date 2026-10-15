// Dev-only entry point for the Decision hints surfaces, with fixture data and no network.
// Scenarios (?scenario=): picker, picker-off, picker-narrow, bash, bash-open, bash-off, gate, gate-off, gate-arrives, settings-present,
// settings-missing, settings-environment, settings-unknown. The gate card's other states are Caliper parts:
// src/gatedActions/GatedActionCard.organism.part.tsx.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import "../src/ui/theme.css";
import type { RiskLabel } from "@shared/riskLabels";
import type { AttentionHint } from "@shared/attentionHints";
import type { PluginCatalog } from "@shared/pluginsContract";
import { resolveAppSettings } from "@shared/appPlugins";
import { accountMetersManifest, decisionHintsManifest } from "@shared/appPluginManifests";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { AppShell } from "../src/ui/AppShell";
import { Picker } from "../src/ui/Picker";
import { PluginsView } from "../src/ui/settings/PluginsView";
import { PinnedDock } from "../src/ui/PinnedDock";
import { GatedActionCard } from "../src/gatedActions/GatedActionCard";
import { RESET, RESET_ENTRY, RISK_DANGER } from "../src/gatedActions/fixtures/gatedActions";
import type { GatewayKey, PluginsApi, RuntimeApi } from "../src/plugins/pluginsApi";
import { rows as boardRows, sections as boardSections, createLocationResolver, DEFAULT_COLLAPSED, type PickerSession, type PickerStatus } from "../src/picker/board";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "picker";
const off = scenario.endsWith("-off");
const repo = "/home/simon/code/forgerie";
const now = Date.parse("2026-10-14T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function PickerScreen() {
  const [open, setOpen] = useState(true);
  const hint = (kind: AttentionHint["kind"], urgency: AttentionHint["urgency"]): AttentionHint =>
    ({ turnId: "t", model: "fast", at: ago(1), likelyNeedsYou: true, ...(kind ? { kind } : {}), ...(urgency ? { urgency } : {}) });
  const idle = (attentionHint?: AttentionHint, extra: Partial<PickerStatus> = {}): PickerStatus =>
    ({ isStreaming: false, isCompacting: false, isBashRunning: false, ...(off || !attentionHint ? {} : { attentionHint }), ...extra });
  const sessions: PickerSession[] = [
    { id: "a", cwd: `${repo}/.worktree/s-01a201`, name: "Pick a retry policy for the export queue", modified: ago(2) },
    { id: "b", cwd: repo, name: "Review the settings store port before it lands", modified: ago(6) },
    { id: "c", cwd: `${repo}/.worktree/s-01a203`, name: "Speed up session listing on a busy machine with long names", modified: ago(11) },
    { id: "d", cwd: repo, name: "Release notes for 1.2", modified: ago(14), response: { kind: "needs-response", reason: "reply" } },
    { id: "e", cwd: repo, name: "Bump typebox and re-run the schema tests", modified: ago(20) },
    { id: "f", cwd: repo, name: "Why does the dock flicker on resume?", modified: ago(40) },
  ];
  const statuses: Record<string, PickerStatus> = {
    a: idle(hint("decision", "high")),
    b: idle(hint("review", "normal")),
    c: idle(hint(undefined, undefined)),
    d: idle(undefined, { needsResponse: true }),
    e: idle({ ...hint("done", "low"), likelyNeedsYou: false }),
    f: idle(),
  };
  const all = boardRows({ sessions, statuses, activities: {}, unread: new Set(["a", "b", "c", "e"]), now,
    locate: createLocationResolver([{ id: "p1", name: "forgerie", path: repo }], []) });
  // The narrowest list the app draws: docked at its 15rem floor.
  if (scenario === "picker-narrow") return <div style={{ inlineSize: "15rem", blockSize: "100vh" }}>{list("docked")}</div>;
  return <AppShell open={open} onOpenChange={setOpen} picker={list} thread={<span />} />;
  function list(layout: "docked" | "overlay") {
    return <Picker view={{ connection: { type: "ready" }, machines: 1, selectedId: "f", archivedCount: 0,
      sections: boardSections(all, { grouping: "state", showArchived: false, now, selectedId: "f" }) }}
      prefs={{ grouping: "state", showArchived: false, collapsed: DEFAULT_COLLAPSED, allPinned: false }} onPrefs={() => {}}
      actions={{ onSelect: () => {}, onRetry: () => {}, onNew: () => {}, onSettings: () => {}, onBacklog: () => {},
        onClose: layout === "overlay" ? () => setOpen(false) : undefined }} />;
  }
}

const tool = (id: string, command: string, state: ToolState, riskLabel?: RiskLabel): TranscriptPart =>
  ({ type: "tool", id, name: "bash", args: { command }, state, ...(riskLabel && !off ? { riskLabel } : {}) });
const done = (output: string): ToolState => ({ type: "done", output, isError: false });
const label = (risk: RiskLabel["risk"], deletes: number, outside: number, acts: number): RiskLabel =>
  ({ model: "fast", deletes_data: deletes, outside_worktree: outside, acts_as_user: acts, risk, risk_score: risk === "low" ? 0.1 : risk === "check" ? 1 : 1.9 });
const transcript: TranscriptMessage[] = [
  { id: "q", role: "user", parts: [{ type: "text", text: "Clean the build output, then publish the preview." }] },
  { id: "a", role: "assistant", parts: [
    { type: "text", text: "I'll look at what the build left behind first." },
    tool("b1", "ls -la dist", done("total 24\ndrwxr-xr-x 4 simon users 4096 Oct 14 11:58 .\n-rw-r--r-- 1 simon users  812 Oct 14 11:58 build.json"), label("low", 0.02, 0.05, 0.03)),
    tool("b2", "rm -rf dist ../forgerie-preview/dist", done(""), label("danger", 0.97, 0.88, 0.05)),
    tool("b3", "gh release upload preview-1.2 dist/forgerie.tgz --clobber", done("Uploaded forgerie.tgz"), label("check", 0.3, 0.2, 0.86)),
    tool("b4", "git status --short", { type: "running", output: "" }),
    { type: "text", text: "The preview is published. Every call has its own line, and the opinion ends it." },
  ] },
];
function BashScreen() {
  // The calls fold behind the reply's tally; open it, and with `bash-open` also the risky call's own lines.
  useEffect(() => {
    const timers = [setTimeout(() => document.querySelector<HTMLButtonElement>(".tally-toggle")?.click(), 300)];
    if (scenario === "bash-open") timers.push(setTimeout(() => document.querySelectorAll<HTMLDetailsElement>("details.tool-call")[1]?.setAttribute("open", ""), 700));
    return () => timers.forEach(clearTimeout);
  }, []);
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(transcript, false), onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}>
    <AppShell open={false} onOpenChange={() => {}} picker={() => <span />}
      thread={<SessionFrame name="Publish the preview"><Thread /></SessionFrame>} />
  </AssistantRuntimeProvider>;
}

/** A gate pinned above the composer, as a session shows it. `gate-arrives` gets its opinion after 2 s, as from the gateway. */
function GateScreen() {
  const [record, setRecord] = useState(scenario === "gate" ? { ...RESET, riskLabel: RISK_DANGER } : RESET);
  useEffect(() => {
    if (scenario !== "gate-arrives") return;
    const timer = setTimeout(() => setRecord((current) => ({ ...current, riskLabel: RISK_DANGER })), 2000);
    return () => clearTimeout(timer);
  }, []);
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(transcript.slice(0, 1), false), onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}>
    <AppShell open={false} onOpenChange={() => {}} picker={() => <span />}
      thread={<SessionFrame name="Clean the export worktree"><Thread beforeComposer={<PinnedDock label="1 waiting for you">
        <GatedActionCard entry={RESET_ENTRY} record={record} read onApprove={() => {}} onRefuse={() => {}} />
      </PinnedDock>} /></SessionFrame>} />
  </AssistantRuntimeProvider>;
}

let catalog: PluginCatalog = { profileDir: "/home/simon/.local/share/forgerie/agent", configPath: "/home/simon/.config/forgerie/config.json",
  home: "/home/simon", revision: "fixture-1", restartAvailable: true, restartRequired: false, plugins: [
    { id: "app:cliproxyapi-quota", kind: "app", name: accountMetersManifest.name, source: "Forgerie", description: accountMetersManifest.description,
      enabled: true, settings: resolveAppSettings(accountMetersManifest, {}), fields: [...accountMetersManifest.settings] },
    { id: "app:decision-hints", kind: "app", name: decisionHintsManifest.name, source: "Forgerie", description: decisionHintsManifest.description,
      enabled: true, settings: resolveAppSettings(decisionHintsManifest, { gateway_url: "http://127.0.0.1:4000" }), fields: [...decisionHintsManifest.settings] },
  ] };
const api: PluginsApi = {
  list: async () => catalog,
  change: async (_revision, change) => {
    catalog = { ...catalog, plugins: catalog.plugins.map((entry) => change.type === "settings" && entry.id === change.id ? { ...entry, settings: change.settings }
      : change.type === "toggle" && entry.id === change.id ? { ...entry, enabled: change.enabled } : entry) };
    return catalog;
  },
  restart: async () => catalog,
  readme: async () => ({ text: null, truncated: false }),
};
let key: GatewayKey = scenario === "settings-missing" ? { keyPresent: false, source: "none" } : scenario === "settings-invalid" ? { keyPresent: false, source: "settings", invalid: true } : scenario === "settings-unknown" ? "unknown"
  : scenario === "settings-environment" ? { keyPresent: true, source: "environment" } : { keyPresent: true, source: "settings" };
const runtime: RuntimeApi = {
  gatewayKey: async () => key,
  setGatewayKey: async () => { key = { keyPresent: true, source: "settings" }; return key; },
  clearGatewayKey: async () => { key = { keyPresent: false, source: "none" }; return key; },
};
function SettingsScreen() {
  const [selected, setSelected] = useState<string | undefined>("app:decision-hints");
  return <AppShell open={false} onOpenChange={() => {}} picker={() => <span />}
    thread={<PluginsView selected={selected} onOpen={setSelected} onBack={() => setSelected(undefined)} onClose={() => setSelected(undefined)} api={api} runtime={runtime} />} />;
}

const screen = scenario.startsWith("bash") ? <BashScreen /> : scenario.startsWith("gate") ? <GateScreen /> : scenario.startsWith("settings") ? <SettingsScreen /> : <PickerScreen />;
createRoot(document.getElementById("root")!).render(screen);
