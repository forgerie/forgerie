// Fixture-only mockup: the Quota shelf as a compact heads-up display, and a
// detail sheet behind it. No runtime, no network.
// ?state=hud renders the sidebar alone; ?state=sheet opens the detail sheet;
// ?state=sheet&account=codex/team@example.com opens it at one account.
//
// Design plan
// -----------
// Job of the shelf: answer "can I keep working, and where" in one glance.
// It draws no account addresses at any size. Each account is its lanes only,
// grouped under its service's mark. The reading is the whole shelf.
// Job of the sheet: answer "which account is that, and why is it that colour".
// Every account by address, every window by its full name (including the ones
// turned off in the shelf), the pace in words, the reset as a date, and the
// banked resets with their action.
// The one idea: the shelf is one press target. Pressing any account opens the
// sheet at that account and marks it, so the reader lands on what they touched.
// Palette and type: the app's tokens only. No new colour, no new typeface.
// Rejected: a hover card per account (no hover on the Fold); an expanding
// shelf (it takes room from the session list, which the shelf must not);
// initials or avatars in place of addresses (they are still labels).
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./quota-hud-mockup.css";
import { SheetDialog } from "../src/ui/SheetDialog";
import { PaceBar } from "../src/ui/PaceBar";
import { SignalDot } from "../src/ui/SignalDot";
import { Figure } from "../src/ui/Figure";
import { Glyph } from "../src/ui/Glyph";
import { AccountMeters } from "../src/plugins/accountMeters/AccountMeters";
import { meterAccount, meterModel, type MeterAccount, type MeterLine } from "../src/plugins/accountMeters/meterModel";
import { orderedWindows, providerRouting, type QuotaProvider, type QuotaWindow } from "../src/plugins/accountMeters/quotaData";
import { PROVIDER_MARKS } from "../src/plugins/accountMeters/providerMarks";
import { NOW, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "../src/plugins/accountMeters/fixtures/quota";

const PACE = { ok: "even", unpaced: "even", dry: "short", loss: "surplus", drained: "empty" } as const;

function mark(provider: { id: string; name: string }): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}

function when(instant: string): string {
  return new Date(instant).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONE });
}

/** The pace in words, and whether it is a problem. */
function standingWords(line: MeterLine, available: boolean): { text: string; tone: "plain" | "warn" | "bad" } {
  const m = line.mark;
  if (!available) return { text: "Not in service.", tone: "bad" };
  if (m.kind === "pool") return m.refusing ? { text: "Refusing work. The provider reports no level.", tone: "bad" }
    : { text: "Answering. The provider reports no level.", tone: "plain" };
  if (m.kind === "balance") return { text: "Prepaid balance. It does not reset.", tone: m.tone === "ok" ? "plain" : m.tone === "low" ? "warn" : "bad" };
  const s = m.standing;
  if (s.kind === "drained") return { text: "Empty until it resets.", tone: "bad" };
  if (s.kind === "unpaced") return { text: "No pace: the window states no length.", tone: "plain" };
  const gap = Math.round(Math.abs(m.remaining - s.pace));
  if (s.kind === "dry") return { text: `${String(gap)} points behind an even spend. It runs dry before it resets.`, tone: "bad" };
  if (s.kind === "loss") return { text: `${String(gap)} points ahead of an even spend. What is left at the reset is lost.`, tone: "warn" };
  return { text: "On pace.", tone: "plain" };
}

function lineMark(line: MeterLine): ReactNode {
  const m = line.mark;
  if (m.kind === "pool") return <SignalDot off={m.refusing} />;
  if (m.kind === "balance") return <Figure tone={m.tone === "ok" ? "plain" : m.tone === "low" ? "warn" : "bad"}>{m.amount}</Figure>;
  return <PaceBar value={m.remaining} pace={m.standing.pace} state={PACE[m.standing.kind]} heat={m.doom} />;
}

/** One window in the sheet: full name, the bar at full width, share, reset as countdown and date, pace in words. */
function WindowRow({ line, quotaWindow, hidden, available }: { line: MeterLine; quotaWindow: QuotaWindow; hidden: boolean; available: boolean }) {
  const words = standingWords(line, available);
  const tone = line.clock.tone === "dry" ? "bad" : line.clock.tone === "loss" ? "warn" : line.clock.tone === "none" ? "faint" : "muted";
  return <li className="qd-window" data-hidden={hidden || undefined}>
    <span className="qd-window-name">{quotaWindow.name}{hidden ? <span className="qd-hidden">off in sidebar</span> : null}</span>
    <span className="qd-window-bar">{lineMark(line)}</span>
    <span className="qd-window-share">{line.share === undefined ? null : <Figure tone="plain">{`${line.share}%`}</Figure>}</span>
    <span className="qd-window-clock"><Figure tone={tone}>{line.clock.text}</Figure></span>
    <span className="qd-window-words" data-tone={words.tone}>
      {words.text}{quotaWindow.resetsAt ? <> Resets {when(quotaWindow.resetsAt)}.</> : null}
    </span>
  </li>;
}

function AccountSection({ provider, account, model, chosen }: {
  provider: QuotaProvider; account: QuotaProvider["accounts"][number]; model: MeterAccount; chosen: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (chosen) ref.current?.scrollIntoView({ block: "center" }); }, [chosen]);
  const routed = providerRouting(provider) === "pinned" && provider.accounts.length > 1 && account.selected;
  const windows = new Map(account.windows.map((w) => [w.id, w]));
  return <section ref={ref} className="qd-account" data-chosen={chosen || undefined} data-out={model.out || undefined}
    aria-label={model.email}>
    <header className="qd-account-head">
      <span className="qd-email">{model.email}</span>
      {routed ? <span className="qd-tag" data-tone="live">Gets the work</span> : null}
      {model.out ? <span className="qd-tag" data-tone="bad">Out of service</span> : null}
    </header>
    {model.lines.length === 0 ? <p className="qd-empty">{model.empty ?? "Nothing to show"}.</p>
      : <ul className="qd-windows">{model.lines.map((line) => {
        const quotaWindow = windows.get(line.id);
        return quotaWindow ? <WindowRow key={line.id} line={line} quotaWindow={quotaWindow}
          hidden={(SETTINGS as Record<string, boolean>)[line.id] === false} available={account.available} /> : null;
      })}</ul>}
    {model.reset ? <div className="qd-reset" data-soon={model.reset.soon || undefined}>
      <RotateCcwIcon aria-hidden className="qd-reset-icon" />
      <span className="qd-reset-words">{model.reset.count === 1 ? "1 reset banked" : `${String(model.reset.count)} resets banked`}.
        {" "}{model.reset.count === 1 ? "It expires" : "The first expires"} {model.reset.soonest}.</span>
      <button type="button" className="qd-reset-use">Use a reset…</button>
    </div> : null}
  </section>;
}

function QuotaSheet({ focus, onClose }: { focus: string | undefined; onClose: () => void }) {
  const age = Math.round((NOW.getTime() - new Date(QUOTA_WITH_RESETS.updatedAt).getTime()) / 60000);
  return <SheetDialog title="Quota" subtitle={`Read ${age <= 1 ? "a minute" : `${String(age)} minutes`} ago`} onClose={onClose}
    closeLabel="Close quota" actions={[{ label: "Refresh", onPress: () => undefined }, { label: "Settings", onPress: () => undefined }]}>
    <div className="qd">
      {QUOTA_WITH_RESETS.providers.map((provider) => <section key={provider.id} className="qd-provider" aria-label={provider.name}>
        <h3 className="qd-provider-head">
          <span className="qd-provider-mark" aria-hidden>{mark(provider)}</span>{provider.name}
          <span className="qd-provider-note">{providerRouting(provider) === "pinned"
            ? provider.accounts.length > 1 ? "Work goes to one account at a time" : "One account"
            : "Work rotates across accounts"}</span>
        </h3>
        {provider.accounts.map((account) => {
          const model = meterAccount(provider.id, account, orderedWindows(account), false, NOW, ZONE);
          return <AccountSection key={model.key} provider={provider} account={account} model={model} chosen={focus === model.key} />;
        })}
      </section>)}
    </div>
  </SheetDialog>;
}

/** Placeholder rows standing in for the session list above the shelf. */
const SESSIONS = ["Quota HUD in the sidebar", "Child branch actions", "Fix reconnect after sleep", "Tally-mark logo", "Workspace services", "Slash palette rows"];

function Sidebar({ onOpen }: { onOpen: (key: string | undefined) => void }) {
  const providers = useMemo(() => meterModel(QUOTA_WITH_RESETS, SETTINGS, NOW, ZONE), []);
  const keys = providers.flatMap((provider) => provider.accounts.map((account) => account.key));
  const [open, setOpen] = useState(true);
  // The whole reading is one press target. The block under the press picks the account the sheet opens at.
  const press = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".shelf-header")) return;
    const block = target.closest(".lane-grid-block");
    const blocks = [...event.currentTarget.querySelectorAll(".lane-grid-block")];
    onOpen(block ? keys[blocks.indexOf(block)] : undefined);
  };
  return <aside className="mock-picker" aria-label="Sessions">
    <div className="mock-picker-head">Sessions</div>
    <ul className="mock-sessions">{SESSIONS.map((title, index) => <li key={title} data-current={index === 0 || undefined}>{title}</li>)}</ul>
    <div className="hud" onClick={press}>
      <AccountMeters view={{ type: "ready", providers, names: false, doubtful: false }} open={open} onToggle={() => setOpen(!open)}
        onRetry={() => undefined} onAskReset={() => undefined} />
    </div>
  </aside>;
}

function App() {
  const params = new URLSearchParams(location.search);
  const [sheet, setSheet] = useState<{ focus: string | undefined } | undefined>(
    params.get("state") === "sheet" ? { focus: params.get("account") ?? undefined } : undefined);
  return <div className="mock-frame">
    <Sidebar onOpen={(focus) => setSheet({ focus })} />
    <main className="mock-main" />
    {sheet ? <QuotaSheet focus={sheet.focus} onClose={() => setSheet(undefined)} /> : null}
  </div>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
