// Fixture-only mockup: the Quota shelf as a heads-up display with no account
// addresses, and a detail sheet behind it, inside the real app frame. The
// sidebar is the product's own Picker and AppShell with fixture sessions; the
// shelf is the product's Shelf and LaneGrid. Budgets are drawn as the sidebar
// draws them, in both places. No runtime, no network.
//
//   ?pool=dot|dots|fade              how a pool with no level is drawn (default dots)
//   ?balance=figure|column|pips      how a balance with no maximum is drawn (default pips)
//   ?state=hud                       the sidebar open, sheet closed
//   ?state=sheet&account=<key>       the sheet open at one account
//   ?state=gallery&subject=pool|balance   each option against every state, at shelf and sheet scale
//
// Press anywhere on the meters to open the sheet at the account you pressed.
import { createRoot } from "react-dom/client";
import { useMemo, useState, type MouseEvent } from "react";
import { ArrowUpIcon, MicIcon, PanelLeftIcon, PlusIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./quota-hud-mockup.css";
import { AppShell } from "../src/ui/AppShell";
import { Picker, type PickerView } from "../src/ui/Picker";
import { Shelf } from "../src/ui/Shelf";
import { LaneGrid } from "../src/ui/LaneGrid";
import { createLocationResolver, DEFAULT_COLLAPSED, rows, sections, type PickerSession, type PickerStatus } from "../src/picker/board";
import type { PickerPrefs } from "../src/picker/prefs";
import { meterModel } from "../src/plugins/accountMeters/meterModel";
import { parseQuotaPayload } from "../src/plugins/accountMeters/quotaData";
import { NOW, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "../src/plugins/accountMeters/fixtures/quota";
import { BALANCE_STYLES, POOL_STYLES, type BalanceStyle, type PoolStyle } from "./quota-marks";
import { laneGroups, QuotaSheet, SheetLanes, type MarkStyles } from "./quota-sheet";

const CLOCK = NOW.getTime();
const ago = (minutes: number) => new Date(CLOCK - minutes * 60_000).toISOString();
const later = (hours: number) => new Date(CLOCK + hours * 3_600_000).toISOString();
const locate = createLocationResolver([{ id: "f", name: "forgerie", path: "/code/forgerie" }, { id: "c", name: "cliproxyapi", path: "/code/cliproxyapi" }], []);
const SESSIONS: PickerSession[] = [
  { id: "hud", cwd: "/code/forgerie", name: "Quota HUD in the sidebar", modified: ago(1) },
  { id: "ask", cwd: "/code/cliproxyapi", name: "Banked resets endpoint", modified: ago(4) },
  { id: "kids", cwd: "/code/forgerie", name: "Child branch actions", modified: ago(18) },
  { id: "sleep", cwd: "/code/forgerie", name: "Fix reconnect after sleep", modified: ago(42) },
  { id: "logo", cwd: "/code/forgerie", name: "Tally-mark logo", modified: ago(190) },
];
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const STATUSES: Record<string, PickerStatus> = { hud: { ...idle, isStreaming: true }, ask: { ...idle, blocked: true } };
const PREFS: PickerPrefs = { grouping: "state", showArchived: false, allPinned: false, collapsed: DEFAULT_COLLAPSED };

function pickerView(): PickerView {
  const all = rows({ sessions: SESSIONS, statuses: STATUSES, activities: {}, unread: new Set(), locate, now: CLOCK });
  return { connection: { type: "ready" }, machines: 1, selectedId: "hud", archivedCount: 0,
    sections: sections(all, { grouping: "state", showArchived: false, now: CLOCK, selectedId: "hud" }) };
}

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return (options as readonly string[]).includes(value ?? "") ? value as T : fallback;
}

/** The thread behind the sidebar: enough of a session to read as the product. */
function Thread() {
  return <div className="session-shell">
    <header className="session-header">
      <span className="app-opener" aria-hidden><PanelLeftIcon size={16} /></span>
      <div className="session-heading"><h1 className="session-title">Quota HUD in the sidebar</h1></div>
    </header>
    <div className="mock-thread">
      <p className="mock-user">Match the sidebar's bars. Pools and balances need work.</p>
      <p className="mock-agent">The sheet now draws the sidebar's lanes, larger, with addresses.</p>
    </div>
    <div className="mock-composer">
      <div className="mock-composer-shell">
        <span>Reply…</span>
        <span className="mock-composer-actions">
          <PlusIcon size={16} aria-hidden /><span className="mock-spacer" /><MicIcon size={16} aria-hidden />
          <span className="mock-send"><ArrowUpIcon size={16} aria-hidden /></span>
        </span>
      </div>
    </div>
  </div>;
}

function MockApp({ styles, initial }: { styles: MarkStyles; initial: { focus: string | undefined } | undefined }) {
  const [sheet, setSheet] = useState(initial);
  const [drawer, setDrawer] = useState(true);
  const [shelfOpen, setShelfOpen] = useState(true);
  const meters = useMemo(() => meterModel(QUOTA_WITH_RESETS, SETTINGS, NOW, ZONE), []);
  // The sheet shows every window, including the ones the shelf hides.
  const detail = useMemo(() => meterModel(QUOTA_WITH_RESETS, {}, NOW, ZONE), []);
  const keys = meters.flatMap((provider) => provider.accounts.map((account) => account.key));
  const view = useMemo(pickerView, []);
  // The whole reading is one press target; the block under the press picks where the sheet opens.
  const press = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".shelf-header")) return;
    const block = target.closest(".lane-grid-block");
    const blocks = [...event.currentTarget.querySelectorAll(".lane-grid-block")];
    setSheet({ focus: block ? keys[blocks.indexOf(block)] : undefined });
  };
  const shelf = <div className="hud" onClick={press}>
    <Shelf id="account-meters" title="Quota" label="Account meters" open={shelfOpen} onToggle={() => setShelfOpen(!shelfOpen)}
      toggleHint={shelfOpen ? "Hide quota" : "Show quota"}>
      <LaneGrid groups={laneGroups(meters, styles, () => undefined)} captions={false} />
    </Shelf>
  </div>;
  return <>
    <AppShell open={drawer} onOpenChange={setDrawer} thread={<Thread />}
      picker={() => <Picker view={view} prefs={PREFS} onPrefs={() => undefined} shelves={shelf}
        actions={{ onSelect: () => undefined, onRetry: () => undefined, onNew: () => undefined, onSettings: () => undefined,
          onBacklog: () => undefined, backlogCount: 8, onClose: () => setDrawer(false) }} />} />
    {sheet ? <QuotaSheet providers={detail} styles={styles} age="1m" focus={sheet.focus} onClose={() => setSheet(undefined)} /> : null}
  </>;
}

/* ---- Gallery: every option against every state it must draw ---- */

const week = 604800;
/** A budget lane above each subject, so a candidate is judged beside the bars it must sit with. */
const BUDGET = { id: "claude", name: "Claude", accounts: [
  { email: "budget@example.com", available: true, selected: true, priority: 0, windows: [
    { id: "seven_day", name: "Seven-day", usedPercent: 38, remainingPercent: 62, resetsAt: later(120), lengthSeconds: week }] }] };
const POOLS = parseQuotaPayload({ version: 1, updatedAt: NOW.toISOString(), providers: [BUDGET,
  { id: "antigravity", name: "Antigravity", routing: "pinned", accounts: [
    { email: "answering@example.com", available: true, selected: true, priority: 0, windows: [
      { id: "antigravity_gemini", name: "Gemini", usedPercent: 0, remainingPercent: 100, resetsAt: later(5) }] },
    { email: "refusing@example.com", available: true, selected: false, priority: 0, windows: [
      { id: "antigravity_gemini", name: "Gemini", usedPercent: 100, remainingPercent: 0, resetsAt: later(19) }] }] }] });
/** Every balance state on one account, so the gallery stays one screen tall. A balance is any window with an amount. */
const BALANCES = parseQuotaPayload({ version: 1, updatedAt: NOW.toISOString(), providers: [BUDGET,
  { id: "openrouter", name: "OpenRouter", routing: "rotating", accounts: [
    { email: "keys@example.com", available: true, selected: true, priority: 0, windows: [
      [148.4, "Topped up"], [7.118, "Today's"], [1.4, "Low"], [0.4, "Dust"], [0, "Empty"]].map(([amount, name], index) =>
      ({ id: `credits_${String(index)}`, name, usedPercent: 0, remainingPercent: 100, resetsAt: null, remainingAmount: amount })) }] }] });

function Gallery({ subject }: { subject: "pool" | "balance" }) {
  const providers = useMemo(() => meterModel(subject === "pool" ? POOLS : BALANCES, {}, NOW, ZONE), [subject]);
  const options: readonly string[] = subject === "pool" ? POOL_STYLES : BALANCE_STYLES;
  return <main className="gallery">
    {options.map((option, index) => {
      const styles: MarkStyles = subject === "pool" ? { pool: option as PoolStyle, balance: "figure" } : { pool: "dot", balance: option as BalanceStyle };
      return <section key={option} className="gallery-combo" aria-label={option}>
        <h2>{index === 0 ? "Today" : `Option ${String.fromCharCode(64 + index)}`}<small>{`${subject}=${option}`}</small></h2>
        <div className="gallery-frames">
          <div className="gallery-shelf"><LaneGrid groups={laneGroups(providers, styles, () => undefined)} captions={false} /></div>
          <div className="gallery-sheet"><SheetLanes providers={providers} styles={styles} /></div>
        </div>
      </section>;
    })}
  </main>;
}

function App() {
  const params = new URLSearchParams(location.search);
  if (params.get("state") === "gallery") return <Gallery subject={params.get("subject") === "balance" ? "balance" : "pool"} />;
  const styles: MarkStyles = { pool: pick<PoolStyle>(params.get("pool"), POOL_STYLES, "dots"),
    balance: pick<BalanceStyle>(params.get("balance"), BALANCE_STYLES, "pips") };
  return <MockApp styles={styles} initial={params.get("state") === "sheet" ? { focus: params.get("account") ?? undefined } : undefined} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
