import { parseQuotaPayload } from "../quotaData";

/** The clock every fixture reads at. */
export const NOW = new Date("2026-10-09T04:45:00Z");

const week = 604800;
/** The live reading of 2026-10-09, with addresses replaced: four providers, seven accounts. */
export const QUOTA = parseQuotaPayload({
  version: 1, updatedAt: "2026-10-09T04:44:12Z",
  providers: [
    { id: "antigravity", name: "Antigravity", routing: "pinned", accounts: [
      { email: "first@example.com", available: true, selected: false, priority: 100, windows: [
        { id: "antigravity_gemini", name: "Gemini", usedPercent: 100, remainingPercent: 0, resetsAt: "2026-10-09T23:31:55Z" },
        { id: "antigravity_claude", name: "Claude", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-16T04:04:13Z" },
      ] },
      { email: "second@example.com", available: true, selected: true, priority: 100, windows: [
        { id: "antigravity_gemini", name: "Gemini", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-09T09:44:13Z" },
      ] },
    ] },
    { id: "claude", name: "Claude", routing: "pinned", accounts: [
      { email: "work@example.com", available: true, selected: true, priority: 100, windows: [
        { id: "five_hour", name: "Five-hour", usedPercent: 27, remainingPercent: 73, resetsAt: "2026-10-09T07:39:59Z", lengthSeconds: 18000 },
        { id: "seven_day", name: "Seven-day", usedPercent: 83, remainingPercent: 17, resetsAt: "2026-10-10T13:59:59Z", lengthSeconds: week },
        { id: "weekly_fable", name: "Fable", usedPercent: 45, remainingPercent: 55, resetsAt: "2026-10-10T13:59:59Z", lengthSeconds: week },
      ] },
    ] },
    { id: "codex", name: "Codex", routing: "pinned", accounts: [
      { email: "team@example.com", available: true, selected: true, priority: 100, windows: [
        { id: "seven_day", name: "Seven-day", usedPercent: 38, remainingPercent: 62, resetsAt: "2026-10-14T03:44:59Z", lengthSeconds: week },
      ] },
      { email: "spare@example.com", available: true, selected: false, priority: 0, windows: [
        { id: "seven_day", name: "Seven-day", usedPercent: 0, remainingPercent: 100, resetsAt: "2026-10-16T04:44:12Z", lengthSeconds: week },
      ] },
      { email: "old@example.com", available: false, selected: false, priority: 100, windows: [] },
    ] },
    { id: "openrouter", name: "OpenRouter", routing: "rotating", accounts: [
      { email: "sk-or-v1-545…", available: true, selected: true, priority: 0, windows: [
        { id: "openrouter_credits", name: "Credits", usedPercent: 64, remainingPercent: 36, resetsAt: null, remainingAmount: 7.118 },
      ] },
    ] },
  ],
});

/** The bars turned off in the saved settings on 2026-10-09. */
export const SETTINGS = { five_hour: false, weekly_fable: false, antigravity_claude: false, antigravity_gpt_oss: false, openrouter_key_limit: false };
