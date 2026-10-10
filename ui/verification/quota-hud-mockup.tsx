// Fixture-only mockup: the Quota shelf as a heads-up display with no account
// addresses, and a detail sheet behind it, inside the real app frame. The
// sidebar is the product's own Picker and AppShell with fixture sessions; the
// shelf is the product's AccountMeters. No runtime, no network.
//
//   ?variant=tiles|strips|schedule|rings   the sheet's drawing (default tiles)
//   ?state=hud                             the sidebar open, sheet closed
//   ?state=sheet&account=<provider/email>  the sheet open at one account
//
// Press anywhere on the meters to open the sheet at the account you pressed.
import { createRoot } from "react-dom/client";
import { useMemo, useState, type MouseEvent } from "react";
import { ArrowUpIcon, MicIcon, PanelLeftIcon, PlusIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./quota-hud-mockup.css";
import { AppShell } from "../src/ui/AppShell";
import { Picker, type PickerView } from "../src/ui/Picker";
import { createLocationResolver, DEFAULT_COLLAPSED, rows, sections, type PickerSession, type PickerStatus } from "../src/picker/board";
import type { PickerPrefs } from "../src/picker/prefs";
import { AccountMeters } from "../src/plugins/accountMeters/AccountMeters";
import { meterModel } from "../src/plugins/accountMeters/meterModel";
import { NOW, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "../src/plugins/accountMeters/fixtures/quota";
import { QuotaSheet, sheetModel, VARIANTS, type Variant } from "./quota-sheet-variants";

const CLOCK = NOW.getTime();
const ago = (minutes: number) => new Date(CLOCK - minutes * 60_000).toISOString();
const locate = createLocationResolver([{ id: "f", name: "forgerie", path: "/code/forgerie" }, { id: "c", name: "cliproxyapi", path: "/code/cliproxyapi" }], []);
const SESSIONS: PickerSession[] = [
  { id: "hud", cwd: "/code/forgerie", name: "Quota HUD in the sidebar", modified: ago(1) },
  { id: "ask", cwd: "/code/cliproxyapi", name: "Banked resets endpoint", modified: ago(4) },
  { id: "kids", cwd: "/code/forgerie", name: "Child branch actions", modified: ago(18) },
  { id: "sleep", cwd: "/code/forgerie", name: "Fix reconnect after sleep", modified: ago(42) },
  { id: "logo", cwd: "/code/forgerie", name: "Tally-mark logo", modified: ago(190) },
  { id: "svc", cwd: "/code/forgerie", name: "Workspace services", modified: ago(600) },
];
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const STATUSES: Record<string, PickerStatus> = { hud: { ...idle, isStreaming: true }, ask: { ...idle, blocked: true } };
const PREFS: PickerPrefs = { grouping: "state", showArchived: false, allPinned: false, collapsed: DEFAULT_COLLAPSED };

function pickerView(): PickerView {
  const all = rows({ sessions: SESSIONS, statuses: STATUSES, activities: {}, unread: new Set(), locate, now: CLOCK });
  return { connection: { type: "ready" }, machines: 1, selectedId: "hud", archivedCount: 0,
    sections: sections(all, { grouping: "state", showArchived: false, now: CLOCK, selectedId: "hud" }) };
}

/** The thread behind the sidebar: enough of a session to read as the product. */
function Thread() {
  return <div className="session-shell">
    <header className="session-header">
      <span className="app-opener" aria-hidden><PanelLeftIcon size={16} /></span>
      <div className="session-heading"><h1 className="session-title">Quota HUD in the sidebar</h1></div>
    </header>
    <div className="mock-thread">
      <p className="mock-user">Drop the account labels from the sidebar. Tap for detail.</p>
      <p className="mock-agent">The shelf now draws lanes only. Pressing it opens the Quota sheet at the account you pressed.</p>
    </div>
    <div className="mock-composer">
      <div className="mock-composer-shell">
        <span className="mock-composer-hint">Reply…</span>
        <span className="mock-composer-actions">
          <PlusIcon size={16} aria-hidden /><span className="mock-spacer" /><MicIcon size={16} aria-hidden />
          <span className="mock-send"><ArrowUpIcon size={16} aria-hidden /></span>
        </span>
      </div>
    </div>
  </div>;
}

function App() {
  const params = new URLSearchParams(location.search);
  const variant = (VARIANTS as readonly string[]).includes(params.get("variant") ?? "") ? params.get("variant") as Variant : "tiles";
  const [sheet, setSheet] = useState<{ focus: string | undefined } | undefined>(
    params.get("state") === "sheet" ? { focus: params.get("account") ?? undefined } : undefined);
  const [drawer, setDrawer] = useState(true);
  const [shelfOpen, setShelfOpen] = useState(true);
  const meters = useMemo(() => meterModel(QUOTA_WITH_RESETS, SETTINGS, NOW, ZONE), []);
  const detail = useMemo(() => sheetModel(QUOTA_WITH_RESETS, SETTINGS, NOW, ZONE), []);
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
    <AccountMeters view={{ type: "ready", providers: meters, names: false, doubtful: false }} open={shelfOpen}
      onToggle={() => setShelfOpen(!shelfOpen)} onRetry={() => undefined} onAskReset={() => undefined} />
  </div>;
  return <>
    <AppShell open={drawer} onOpenChange={setDrawer} thread={<Thread />}
      picker={() => <Picker view={view} prefs={PREFS} onPrefs={() => undefined} shelves={shelf}
        actions={{ onSelect: () => undefined, onRetry: () => undefined, onNew: () => undefined, onSettings: () => undefined,
          onBacklog: () => undefined, backlogCount: 8, onClose: () => setDrawer(false) }} />} />
    {sheet ? <QuotaSheet variant={variant} providers={detail} age="1m" focus={sheet.focus} onClose={() => setSheet(undefined)} /> : null}
  </>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
