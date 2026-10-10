// Fixture-only mockup: the Quota shelf as a compact heads-up display, and a
// detail sheet behind it. No runtime, no network.
// ?state=hud renders the sidebar alone; ?state=sheet opens the detail sheet;
// ?state=sheet&account=codex/team@example.com opens it at one account.
//
// Design plan
// -----------
// Show, don't tell. Neither surface prints a sentence. Words live only in
// hover text and screen-reader names.
// Shelf: the existing lanes with no addresses. One press target.
// Sheet: the one piece of text it adds is the address, because that is the
// question the shelf cannot answer. Everything else is drawn:
//   - each window is a burn chart: time runs left to right across the window,
//     the diagonal is an even spend, the dot is you now, the shaded part is
//     time already gone. The wedge from the dot to the reset, against the
//     diagonal, is the problem: solid amber to red above it (credit you will
//     lose), hatched below it (you run dry), as the shelf draws them;
//   - the reset clock sits under the chart's right edge, where the reset is;
//   - the routed account wears the shelf's riser; an account out of service
//     is struck and faded; a window hidden in the shelf is faded with an
//     eye-off mark;
//   - banked resets are a chip of reset marks, one per reset.
// Palette and type: the app's tokens only.
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { EyeOffIcon, RefreshCwIcon, RotateCcwIcon, Settings2Icon } from "lucide-react";
import "../src/ui/theme.css";
import "./quota-hud-mockup.css";
import { SheetDialog } from "../src/ui/SheetDialog";
import { PaceBar } from "../src/ui/PaceBar";
import { Figure, type FigureTone } from "../src/ui/Figure";
import { Glyph } from "../src/ui/Glyph";
import { AccountMeters } from "../src/plugins/accountMeters/AccountMeters";
import { meterAccount, meterModel, type MeterAccount, type MeterLine } from "../src/plugins/accountMeters/meterModel";
import { orderedWindows, providerRouting, windowLabel, type QuotaProvider } from "../src/plugins/accountMeters/quotaData";
import { PROVIDER_MARKS } from "../src/plugins/accountMeters/providerMarks";
import { NOW, QUOTA_WITH_RESETS, SETTINGS, ZONE } from "../src/plugins/accountMeters/fixtures/quota";

const PACE = { ok: "even", unpaced: "even", dry: "short", loss: "surplus", drained: "empty" } as const;
const CLOCK_TONE: Record<string, FigureTone> = { dry: "bad", loss: "warn", none: "faint", plain: "muted" };

function mark(provider: { id: string; name: string }): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}

/**
 * A window as a burn chart. x: the window from its start to its reset. y: the
 * share left. The diagonal is an even spend; the dot is now.
 */
function BurnChart({ remaining, pace, kind, doom }: { remaining: number; pace: number; kind: string; doom: number }) {
  const now = 100 - pace;
  const dot = 100 - remaining;
  const even = 100 - pace;
  const gap = kind === "loss" || kind === "dry" || kind === "drained";
  return <span className="burn" data-kind={kind} style={{ "--now": `${String(now)}%`, "--level": `${String(dot)}%`, "--heat": doom }}>
    <svg className="burn-plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <rect className="burn-past" x="0" y="0" width={now} height="100" />
      <line className="burn-even" x1="0" y1="0" x2="100" y2="100" />
      <line className="burn-now" x1={now} y1="0" x2={now} y2="100" />
    </svg>
    {gap ? <i className="burn-wedge" style={{ clipPath: `polygon(${String(now)}% ${String(dot)}%, 100% 100%, ${String(now)}% ${String(even)}%)` }} /> : null}
    <i className="burn-dot" />
  </span>;
}

/** One window as a tile: its short name and the share, the drawing, and the reset clock under the reset end. */
function WindowTile({ line, name, hidden, out }: { line: MeterLine; name: string; hidden: boolean; out: boolean }) {
  const m = line.mark;
  let figure: ReactNode = null;
  let drawing: ReactNode;
  if (m.kind === "pool") {
    drawing = <span className="tile-pool" data-off={m.refusing || undefined} />;
  } else if (m.kind === "balance") {
    figure = <span className="tile-big" data-tone={m.tone}>{m.amount}</span>;
    drawing = null;
  } else {
    figure = <span className="tile-big" data-tone={m.standing.kind}>{String(m.remaining)}</span>;
    drawing = m.standing.pace === undefined
      ? <span className="tile-bar"><PaceBar value={m.remaining} state={PACE[m.standing.kind]} /></span>
      : <BurnChart remaining={m.remaining} pace={m.standing.pace} kind={m.standing.kind} doom={m.doom} />;
  }
  return <li className="tile" data-hidden={hidden || undefined} data-out={out || undefined} data-kind={m.kind} title={line.words} aria-label={line.words}>
    <span className="tile-label">{line.label ?? name}{hidden ? <EyeOffIcon aria-hidden className="tile-eye" /> : null}</span>
    {figure}
    <span className="tile-draw">{drawing}</span>
    <span className="tile-clock"><Figure tone={CLOCK_TONE[line.clock.tone]}>{line.clock.text}</Figure></span>
  </li>;
}

function AccountRow({ model, names, routed, chosen }: { model: MeterAccount; names: ReadonlyMap<string, string>; routed: boolean; chosen: boolean }) {
  const ref = useRef<HTMLElement>(null);
  // The sheet opens in its own effect, after this one; scroll once it is drawn.
  useEffect(() => {
    if (!chosen) return;
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [chosen]);
  const hiddenIds = SETTINGS as Record<string, boolean>;
  return <section ref={ref} className="acct" data-chosen={chosen || undefined} data-out={model.out || undefined}
    data-routed={routed || undefined} aria-label={`${model.email}${routed ? ", gets the work" : ""}${model.out ? ", out of service" : ""}`}>
    <header className="acct-head">
      <span className="acct-email">{model.email}</span>
      {model.reset ? <button type="button" className="acct-reset" data-soon={model.reset.soon || undefined}
        aria-label={`${model.reset.words}. Use a reset…`} title={`${model.reset.words}. Use a reset…`}>
        {Array.from({ length: model.reset.count }, (_, index) => <RotateCcwIcon key={index} aria-hidden />)}
        <span>{model.reset.soonest}</span>
      </button> : null}
    </header>
    {model.lines.length === 0 ? <span className="acct-none" title={model.empty}>—</span>
      : <ul className="tiles">{model.lines.map((line) =>
        <WindowTile key={line.id} line={line} name={windowLabel({ id: line.id, name: names.get(line.id) ?? line.id }) ?? names.get(line.id) ?? line.id} hidden={hiddenIds[line.id] === false} out={model.out} />)}</ul>}
  </section>;
}

function QuotaSheet({ focus, onClose }: { focus: string | undefined; onClose: () => void }) {
  const age = Math.round((NOW.getTime() - new Date(QUOTA_WITH_RESETS.updatedAt).getTime()) / 60000);
  const tools = <span className="qd-tools">
    <Figure>{`${String(Math.max(1, age))}m`}</Figure>
    <button type="button" className="qd-icon" aria-label="Refresh" title="Refresh"><RefreshCwIcon aria-hidden /></button>
    <button type="button" className="qd-icon" aria-label="Quota settings" title="Quota settings"><Settings2Icon aria-hidden /></button>
  </span>;
  return <SheetDialog title="Quota" subtitle={tools} onClose={onClose} closeLabel="Close quota">
    <div className="qd">
      {QUOTA_WITH_RESETS.providers.map((provider: QuotaProvider) => <section key={provider.id} className="qd-provider" aria-label={provider.name}>
        <h3 className="qd-provider-head" title={provider.name}><span className="qd-provider-mark" aria-hidden>{mark(provider)}</span>{provider.name}</h3>
        {provider.accounts.map((account) => {
          const model = meterAccount(provider.id, account, orderedWindows(account), false, NOW, ZONE);
          const routed = providerRouting(provider) === "pinned" && provider.accounts.length > 1 && account.selected;
          const names = new Map(account.windows.map((w) => [w.id, w.name]));
          return <AccountRow key={model.key} model={model} names={names} routed={routed} chosen={focus === model.key} />;
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
