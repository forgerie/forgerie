import type { AppPluginManifest } from "./appPlugins.js";

/**
 * Account meters: the quota each AI account has left, read from the
 * CLIProxyAPI router, at the foot of the session list.
 *
 * The id is the original client plugin's id, so the bars a user already
 * turned off there stay off. One toggle per bar the router reports, keyed by
 * the router's window id. A window the router adds later has no toggle and
 * stays visible.
 */
export const accountMetersManifest: AppPluginManifest = {
  id: "cliproxyapi-quota",
  name: "Account meters",
  description: "Shows how much quota each AI account has left, at the foot of the session list.",
  settings: [
    { type: "url", id: "endpoint", label: "Quota address", default: "https://cliproxyapi.hummingbird-lake.ts.net/quota",
      description: "The CLIProxyAPI router's /quota address. The router must allow this app's address to read it." },
    { type: "boolean", id: "five_hour", label: "Five-hour window", description: "Claude's rolling five-hour allowance.", default: true },
    { type: "boolean", id: "seven_day", label: "Seven-day window", description: "The weekly allowance of Claude and Codex accounts.", default: true },
    { type: "boolean", id: "weekly_fable", label: "Fable window", description: "Claude's weekly allowance for the Fable model. It resets with the seven-day window.", default: true },
    { type: "boolean", id: "antigravity_gemini", label: "Antigravity Gemini pool", description: "The pool the router sends Antigravity Gemini work to.", default: true },
    { type: "boolean", id: "antigravity_claude", label: "Antigravity Claude pool", description: "The pool the router sends Antigravity Claude work to.", default: true },
    { type: "boolean", id: "antigravity_gpt_oss", label: "Antigravity GPT-OSS pool", description: "The pool the router sends Antigravity GPT-OSS work to.", default: true },
    { type: "boolean", id: "openrouter_key_limit", label: "OpenRouter key limit", description: "The key's own spend limit.", default: true },
    { type: "boolean", id: "openrouter_credits", label: "OpenRouter credits", description: "The account's prepaid balance.", default: true },
  ],
};

export const decisionHintsManifest: AppPluginManifest = {
  id: "decision-hints", name: "Decision hints", defaultEnabled: false, runtime: "server",
  description: "Adds optional attention and risk hints. When enabled, turn replies and commands leave this machine through the gateway. Hints never approve actions or delay replies or commands.",
  settings: [
    { type: "url", id: "gateway_url", label: "Gateway address", description: "The gateway base address, without /v1/systemone. Leave empty for no hints.", default: "", optional: true },
    { type: "text", id: "model", label: "Model", description: "The model name configured by your gateway.", default: "fast" },
    { type: "boolean", id: "attention", label: "Attention hints", description: "Suggests which completed turns need your attention.", default: true },
    { type: "boolean", id: "risk_labels", label: "Risk labels", description: "Adds information to gated actions and commands. Gates stay unchanged.", default: true },
    { type: "choice", id: "sensitivity", label: "Sensitivity", description: "How readily hints call for your attention.", default: "normal", choices: ["low", "normal", "high"] },
  ],
};

/** Every bundled app plugin (browser and server), in the order Settings lists them. */
export const APP_PLUGIN_MANIFESTS: readonly AppPluginManifest[] = [accountMetersManifest, decisionHintsManifest];
