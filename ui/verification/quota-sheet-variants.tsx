// The Quota detail sheet in four drawings. Each answers "which account, and
// how does it stand" with pictures; words live in hover text and
// screen-reader names. All four share one model, built from the meters' own
// rules, so a window reads the same in every drawing and in the sidebar.
//
//   tiles     one card per window, a burn chart in each
//   strips    one row per window, a short burn chart on shared columns
//   schedule  every window on one time axis, so what resets next is plain
//   rings     one ring per window, share left around it, pace as a tick
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { EyeOffIcon, RefreshCwIcon, RotateCcwIcon, Settings2Icon } from "lucide-react";
import { SheetDialog } from "../src/ui/SheetDialog";
import { Figure, type FigureTone } from "../src/ui/Figure";
import { Glyph } from "../src/ui/Glyph";
import { meterAccount, type MeterLine, type ResetMarker } from "../src/plugins/accountMeters/meterModel";
import { orderedWindows, providerRouting, windowLabel, type QuotaPayload } from "../src/plugins/accountMeters/quotaData";
import { PROVIDER_MARKS } from "../src/plugins/accountMeters/providerMarks";

export type Variant = "tiles" | "strips" | "schedule" | "rings";
export const VARIANTS: readonly Variant[] = ["tiles", "strips", "schedule", "rings"];

type Standing = "ok" | "unpaced" | "dry" | "loss" | "drained";
interface Win {
  id: string;
  label: string;
  kind: "bar" | "pool" | "balance";
  /** Share left, 0..100. For a pool, 100 answering and 0 refusing. */
  remaining: number;
  /** Share an even spend would leave now; undefined without a known length. */
  pace: number | undefined;
  standing: Standing;
  /** 0..1, how hard unspent credit burns (the sidebar's heat). */
  heat: number;
  amount: string | undefined;
  amountTone: "ok" | "low" | "out";
  clock: { text: string; tone: FigureTone };
  /** Milliseconds from now to the reset; undefined when it never resets. */
  left: number | undefined;
  hidden: boolean;
  words: string;
}
interface Acct { key: string; email: string; routed: boolean; out: boolean; reset: ResetMarker | undefined; windows: Win[]; empty: string | undefined }
interface Prov { id: string; name: string; accounts: Acct[] }

const CLOCK_TONE: Record<string, FigureTone> = { dry: "bad", loss: "warn", none: "faint", plain: "muted" };

function win(line: MeterLine, name: string, resetsAt: string | null | undefined, hidden: boolean, now: Date): Win {
  const m = line.mark;
  const left = resetsAt ? Math.max(0, new Date(resetsAt).getTime() - now.getTime()) : undefined;
  const base = { id: line.id, label: line.label ?? name, clock: { text: line.clock.text, tone: CLOCK_TONE[line.clock.tone] ?? "muted" },
    left, hidden, words: line.words, amount: undefined, amountTone: "ok" as const, heat: 0, pace: undefined };
  if (m.kind === "pool") return { ...base, kind: "pool", remaining: m.refusing ? 0 : 100, standing: m.refusing ? "drained" : "unpaced" };
  if (m.kind === "balance") return { ...base, kind: "balance", remaining: 100, standing: "unpaced", amount: m.amount, amountTone: m.tone };
  return { ...base, kind: "bar", remaining: m.remaining, pace: m.standing.pace, standing: m.standing.kind, heat: m.doom };
}

export function sheetModel(payload: QuotaPayload, settings: Readonly<Record<string, unknown>>, now: Date, zone: string): Prov[] {
  return payload.providers.map((provider) => ({ id: provider.id, name: provider.name, accounts: provider.accounts.map((account) => {
    const model = meterAccount(provider.id, account, orderedWindows(account), false, now, zone);
    const raw = new Map(account.windows.map((w) => [w.id, w]));
    return { key: model.key, email: model.email, out: model.out, reset: model.reset, empty: model.empty,
      routed: providerRouting(provider) === "pinned" && provider.accounts.length > 1 && account.selected,
      windows: model.lines.map((line) => {
        const source = raw.get(line.id);
        return win(line, (source && windowLabel(source)) ?? source?.name ?? line.id, source?.resetsAt, settings[line.id] === false, now);
      }) };
  }) }));
}

function mark(provider: { id: string; name: string }): ReactNode {
  const path = PROVIDER_MARKS[provider.id];
  return path ? <Glyph path={path} /> : <Figure>{provider.name.slice(0, 1).toUpperCase()}</Figure>;
}
const style = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ---------- Shared pieces ---------- */

/** Banked resets: one mark per reset, then when the first lapses. */
function ResetChip({ reset }: { reset: ResetMarker }) {
  const label = `${reset.words}. Use a reset…`;
  return <button type="button" className="qs-reset" data-soon={reset.soon || undefined} aria-label={label} title={label}>
    <RotateCcwIcon aria-hidden /><span className="qs-reset-count" aria-hidden>{String(reset.count)}</span>
    <span className="qs-reset-date" aria-hidden>{reset.soonest}</span>
  </button>;
}

function AccountHead({ account }: { account: Acct }) {
  return <header className="qs-acct-head">
    <span className="qs-email" title={account.email}>{account.email}</span>
    {account.reset ? <ResetChip reset={account.reset} /> : null}
  </header>;
}

/** An account's frame: the riser for the routed one, the struck address for one out of service, and the landing mark for the one pressed. */
function Account({ account, chosen, children }: { account: Acct; chosen: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!chosen) return;
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [chosen]);
  const name = `${account.email}${account.routed ? ", gets the work" : ""}${account.out ? ", out of service" : ""}`;
  return <section ref={ref} className="qs-acct" aria-label={name} data-chosen={chosen || undefined} data-routed={account.routed || undefined}
    data-out={account.out || undefined}>{children}</section>;
}

function Provider({ provider, children }: { provider: Prov; children: ReactNode }) {
  return <section className="qs-prov" aria-label={provider.name}>
    <h3 className="qs-prov-head"><span className="qs-prov-mark" aria-hidden>{mark(provider)}</span>{provider.name}</h3>
    {children}
  </section>;
}

function Hidden({ hidden }: { hidden: boolean }) {
  return hidden ? <EyeOffIcon className="qs-eye" aria-label="Hidden in the sidebar" /> : null;
}

/**
 * A window as a burn chart. x runs from the window's start to its reset; y is
 * the share left. The dashed diagonal is an even spend, the dot is now, and
 * the shaded band is time already gone. The wedge from the dot to the reset,
 * against the diagonal, is the trouble: solid where credit expires unspent,
 * hatched where the window runs dry first.
 */
function Burn({ w, size }: { w: Win; size: "tall" | "short" }) {
  if (w.pace === undefined) {
    return <span className="qs-burn" data-size={size} data-flat>
      <i className="qs-burn-track"><i className="qs-burn-level" style={{ inlineSize: `${String(w.remaining)}%` }} /></i>
    </span>;
  }
  const now = 100 - w.pace;
  const level = 100 - w.remaining;
  const trouble = w.standing === "loss" || w.standing === "dry" || w.standing === "drained";
  return <span className="qs-burn" data-size={size} data-standing={w.standing}
    style={style({ "--now": `${String(now)}%`, "--level": `${String(level)}%`, "--heat": w.heat })}>
    <i className="qs-burn-past" />
    <svg className="qs-burn-plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <line className="qs-burn-even" x1="0" y1="0" x2="100" y2="100" />
    </svg>
    {trouble ? <i className="qs-burn-wedge" style={{ clipPath: `polygon(${String(now)}% ${String(level)}%, 100% 100%, ${String(now)}% ${String(now)}%)` }} /> : null}
    <i className="qs-burn-dot" />
  </span>;
}

function Share({ w, big = false }: { w: Win; big?: boolean }) {
  if (w.kind === "balance") return <span className="qs-share" data-big={big || undefined} data-tone={w.amountTone}>{w.amount}</span>;
  if (w.kind === "pool") return <span className="qs-share" data-big={big || undefined} data-tone={w.remaining === 0 ? "out" : "ok"} aria-hidden>
    <i className="qs-pool" data-off={w.remaining === 0 || undefined} /></span>;
  return <span className="qs-share" data-big={big || undefined} data-tone={w.standing === "drained" ? "out" : "ok"}>{String(w.remaining)}</span>;
}

function Clock({ w }: { w: Win }) {
  return <span className="qs-clock"><Figure tone={w.clock.tone}>{w.clock.text}</Figure></span>;
}

/* ---------- Tiles ---------- */

function Tiles({ account }: { account: Acct }) {
  return <ul className="qs-tiles">{account.windows.map((w) =>
    <li key={w.id} className="qs-tile" data-kind={w.kind} data-hidden={w.hidden || undefined} title={w.words} aria-label={w.words}>
      <span className="qs-tile-label">{w.label}<Hidden hidden={w.hidden} /></span>
      <Share w={w} big />
      {w.kind === "bar" ? <span className="qs-tile-draw"><Burn w={w} size="tall" /></span> : null}
      <Clock w={w} />
    </li>)}</ul>;
}

/* ---------- Strips ---------- */

function Strips({ account }: { account: Acct }) {
  return <ul className="qs-strips">{account.windows.map((w) =>
    <li key={w.id} className="qs-strip" data-kind={w.kind} data-hidden={w.hidden || undefined} title={w.words} aria-label={w.words}>
      <span className="qs-strip-label">{w.label}<Hidden hidden={w.hidden} /></span>
      <span className="qs-strip-draw">{w.kind === "bar" ? <Burn w={w} size="short" /> : <i className="qs-strip-rule" />}</span>
      <Share w={w} />
      <Clock w={w} />
    </li>)}</ul>;
}

/* ---------- Rings ---------- */

const R = 17;
const C = 2 * Math.PI * R;
function arc(from: number, to: number) {
  const length = Math.max(0, to - from) / 100 * C;
  return { strokeDasharray: `${String(length)} ${String(C)}`, strokeDashoffset: String(-from / 100 * C) };
}
/** The same span drawn as short ticks, the ring's hatching. */
function hatched(from: number, to: number) {
  const start = from / 100 * C;
  const end = to / 100 * C;
  const dashes: number[] = [0, start];
  for (let at = start; at < end; at += 2.4) dashes.push(Math.min(1, end - at), 1.4);
  dashes.push(0, C);
  return { strokeDasharray: dashes.map((d) => d.toFixed(2)).join(" ") };
}
const TURN = "rotate(-90 20 20)";
function Ring({ w }: { w: Win }) {
  const pace = w.pace;
  const fill = w.remaining;
  const even = pace === undefined ? fill : Math.min(fill, pace);
  return <span className="qs-ring" data-standing={w.standing} data-kind={w.kind} style={style({ "--heat": w.heat })}>
    <svg viewBox="0 0 40 40" aria-hidden>
      <circle className="qs-ring-ground" cx="20" cy="20" r={R} />
      {w.kind === "bar" ? <>
        <circle className="qs-ring-fill" cx="20" cy="20" r={R} transform={TURN} style={arc(0, even)} />
        {pace !== undefined && fill > pace && w.standing === "loss" ? <circle className="qs-ring-surplus" cx="20" cy="20" r={R} transform={TURN} style={arc(pace, fill)} />
          : pace !== undefined && fill > pace ? <circle className="qs-ring-fill" cx="20" cy="20" r={R} transform={TURN} style={arc(pace, fill)} /> : null}
        {pace !== undefined && fill < pace && w.standing !== "ok" ? <circle className="qs-ring-short" cx="20" cy="20" r={R} transform={TURN} style={hatched(fill, pace)} /> : null}
        {pace !== undefined ? <line className="qs-ring-pace" x1="20" y1="0" x2="20" y2="6.5" transform={`rotate(${String(pace * 3.6)} 20 20)`} /> : null}
      </> : w.kind === "pool" ? <circle className="qs-ring-pool" data-off={w.remaining === 0 || undefined} cx="20" cy="20" r={R} /> : null}
    </svg>
    <span className="qs-ring-centre"><Share w={w} /></span>
  </span>;
}
function Rings({ account }: { account: Acct }) {
  return <ul className="qs-rings">{account.windows.map((w) =>
    <li key={w.id} className="qs-ring-cell" data-hidden={w.hidden || undefined} title={w.words} aria-label={w.words}>
      <Ring w={w} />
      <span className="qs-ring-label">{w.label}<Hidden hidden={w.hidden} /></span>
      <Clock w={w} />
    </li>)}</ul>;
}

/* ---------- Schedule ---------- */

const HOUR = 3_600_000;
const TICKS = [{ at: HOUR, label: "1h" }, { at: 6 * HOUR, label: "6h" }, { at: 24 * HOUR, label: "1d" }, { at: 72 * HOUR, label: "3d" }, { at: 168 * HOUR, label: "7d" }];
/** Square-root time: the next hours get room, and a week still fits. */
const place = (t: number, horizon: number) => Math.sqrt(Math.min(1, Math.max(0, t / horizon))) * 100;

/**
 * A window on the shared axis: its credit drawn from now to its reset as the
 * share it would hold under an even spend. A tall, short shape must be spent
 * fast; a long, low one has time.
 */
function Lane({ w, horizon }: { w: Win; horizon: number }) {
  const end = w.left === undefined ? 100 : place(w.left, horizon);
  const ticks = TICKS.filter((tick) => tick.at <= horizon).map((tick) => place(tick.at, horizon));
  let shape: ReactNode = null;
  const left = w.left;
  if (w.kind === "bar" && left !== undefined && w.remaining > 0) {
    // Clipped from a box, so the fill is CSS: plain, the warm surplus, or the dry hatching.
    const steps = 24;
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const t = (index / steps) * left;
      return `${place(t, horizon).toFixed(2)}% ${(100 - w.remaining * (1 - t / left)).toFixed(2)}%`;
    });
    shape = <i className="qs-lane-shape" style={{ clipPath: `polygon(0% 100%, ${points.join(", ")}, ${end.toFixed(2)}% 100%)` }} />;
  }
  return <span className="qs-lane" data-kind={w.kind} data-standing={w.standing} style={style({ "--end": `${String(end)}%`, "--heat": w.heat })}>
    <svg className="qs-lane-plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {ticks.map((x) => <line key={x} className="qs-lane-tick" x1={x} y1="0" x2={x} y2="100" />)}
    </svg>
    {shape}
    {w.kind !== "bar" || w.remaining === 0 ? <i className="qs-lane-rule" /> : null}
    {w.kind === "pool" ? <i className="qs-lane-pool" data-off={w.remaining === 0 || undefined} /> : null}
    {w.left !== undefined ? <i className="qs-lane-reset" /> : null}
  </span>;
}

function Schedule({ providers, focus }: { providers: Prov[]; focus: string | undefined }) {
  const lefts = providers.flatMap((p) => p.accounts.flatMap((a) => a.windows.map((w) => w.left ?? 0)));
  const longest = Math.max(24 * HOUR, ...lefts);
  const horizon = TICKS.find((tick) => tick.at >= longest)?.at ?? longest;
  return <div className="qs-sched">
    <div className="qs-axis" aria-hidden>
      <span className="qs-axis-now">now</span>
      <span className="qs-axis-track">{TICKS.filter((tick) => tick.at <= horizon).map((tick) =>
        <span key={tick.label} className="qs-axis-tick" style={{ insetInlineStart: `${String(place(tick.at, horizon))}%` }}>{tick.label}</span>)}</span>
    </div>
    {providers.map((provider) => <Provider key={provider.id} provider={provider}>
      {provider.accounts.map((account) => <Account key={account.key} account={account} chosen={focus === account.key}>
        <AccountHead account={account} />
        {account.windows.length === 0 ? <span className="qs-none" title={account.empty}>—</span>
          : <ul className="qs-lanes">{account.windows.map((w) =>
            <li key={w.id} className="qs-lane-row" data-hidden={w.hidden || undefined} title={w.words} aria-label={w.words}>
              <span className="qs-strip-label">{w.label}<Hidden hidden={w.hidden} /></span>
              <Lane w={w} horizon={horizon} />
              <Share w={w} />
              <Clock w={w} />
            </li>)}</ul>}
      </Account>)}
    </Provider>)}
  </div>;
}

/* ---------- The sheet ---------- */

const BODIES: Record<Exclude<Variant, "schedule">, (props: { account: Acct }) => ReactNode> = { tiles: Tiles, strips: Strips, rings: Rings };

export function QuotaSheet({ variant, providers, age, focus, onClose }: {
  variant: Variant; providers: Prov[]; age: string; focus: string | undefined; onClose: () => void;
}) {
  const tools = <span className="qs-tools">
    <span className="qs-age" title="Read 1 minute ago" aria-label="Read 1 minute ago">{age}</span>
    <button type="button" className="qs-icon" aria-label="Refresh" title="Refresh"><RefreshCwIcon aria-hidden /></button>
    <button type="button" className="qs-icon" aria-label="Quota settings" title="Quota settings"><Settings2Icon aria-hidden /></button>
  </span>;
  const Body = variant === "schedule" ? undefined : BODIES[variant];
  return <SheetDialog title="Quota" subtitle={tools} onClose={onClose} closeLabel="Close quota">
    <div className="qs" data-variant={variant}>
      {Body === undefined ? <Schedule providers={providers} focus={focus} />
        : providers.map((provider) => <Provider key={provider.id} provider={provider}>
          {provider.accounts.map((account) => <Account key={account.key} account={account} chosen={focus === account.key}>
            <AccountHead account={account} />
            {account.windows.length === 0 ? <span className="qs-none" title={account.empty}>—</span> : <Body account={account} />}
          </Account>)}
        </Provider>)}
    </div>
  </SheetDialog>;
}
