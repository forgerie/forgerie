/* Round 28: the nested row against the pooled one.
 *
 * Every problem rounds 19 to 27 hit came from the same place. The pooled
 * bar's length is a mean, so one account's loss is divided by the account
 * count, two losses queued behind each other collapse into one, and the
 * readout has to carry warnings the bar cannot. Each fix worked and each one
 * spent something.
 *
 * The nested row does not have that problem, because it never averages. Each
 * account keeps its own line, its own cut and its own surplus, drawn at full
 * size. A 78-point loss is 78 points of hollow, not 26. Two losses are two
 * hollows. Six accounts are six lines.
 *
 * What it spends instead is height, and that is the trade to look at.
 *
 * Three columns:
 *
 *   pool       round 27's `both`: one pooled bar, the total at risk in the
 *              number, the first two deadlines in the countdown.
 *   nest       one line per account, soonest reset at the top so the queue
 *              reads downward, and a plain readout: what the pinned account
 *              holds, and when the group next loses something.
 *   nestboth   the same lines with round 27's readout on top, to see whether
 *              the louder readout is still worth its width once every loss
 *              is already drawn at full size.
 *
 * Ordering by reset rather than by pinned account is a change from round 15.
 * The pinned account keeps its rail, so it is still findable, but the top
 * line is now the next thing to expire. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const WEEK = 7 * DAY;

  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = (values) => values.reduce((sum, value) => sum + value, 0);

  const at = (percent, leftMs, pinned = false) => ({
    percent: clamp(percent),
    leftMs,
    pinned,
    pace: clamp((leftMs / WEEK) * 100),
    get surplus() { return Math.max(0, this.percent - this.pace); },
  });

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  const toneOf = (share) => (share <= 0 ? "dead" : share < 10 ? "danger" : share < 30 ? "warn" : "ok");

  const AT_RISK = 10;
  const risky = (accounts) => accounts.filter((a) => a.surplus >= AT_RISK).sort((a, b) => a.leftMs - b.leftMs);

  const run = (cls, from, to) => {
    const node = el("i", cls);
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0.6, to - from)}%`;
    return node;
  };

  /** Ground, fill, split cut, hatch, and the expiring run, into one box. */
  function draw(box, fill, pace, risk) {
    box.style.setProperty("--fill", `${fill}%`);
    box.style.setProperty("--pace", `${pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) box.append(el("i", "w-fill right"));
    if (fill < pace && fill > 0) box.append(el("i", "w-hatch"));
    if (risk >= 0.5) box.append(run("b-void", Math.max(0, fill - risk), fill));
  }

  const BARS = {
    /* One bar, every quantity averaged. */
    pool(lanes, accounts) {
      const lane = el("span", "b-lane w-lane hue1 tone-ok");
      draw(lane, mean(accounts.map((a) => a.percent)), mean(accounts.map((a) => a.pace)),
        mean(accounts.map((a) => a.surplus)));
      for (let seam = 1; seam < accounts.length; seam += 1) {
        const mark = el("i", "b-riser");
        mark.style.left = `${(seam / accounts.length) * 100}%`;
        lane.append(mark);
      }
      lanes.append(lane);
    },

    /* One line per account, soonest reset first, nothing averaged. */
    nest(lanes, accounts) {
      const stack = el("span", "b-nest");
      for (const account of [...accounts].sort((a, b) => a.leftMs - b.leftMs)) {
        const line = el("span", `b-line${account.pinned ? " pinned" : ""}`);
        const lane = el("span", "b-lane w-lane hue1 tone-ok");
        draw(lane, account.percent, account.pace, account.surplus);
        line.append(lane);
        stack.append(line);
      }
      lanes.append(stack);
    },
  };

  const READOUTS = {
    /* What the pinned account holds, and when the group next loses anything. */
    plain(accounts) {
      const held = accounts.filter((a) => a.percent > 0);
      const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
      const queue = risky(accounts);
      const clock = queue.length > 0
        ? queue[0].leftMs
        : Math.min(...(held.length > 0 ? held : accounts).map((a) => a.leftMs));
      return { text: `${Math.round(pin.percent)}%`, tone: toneOf(pin.percent), label: span(clock) };
    },

    /* Round 27's: the total about to go, and the first two deadlines. */
    both(accounts) {
      const held = accounts.filter((a) => a.percent > 0);
      const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
      const queue = risky(accounts);
      if (pin.percent < 10 || queue.length === 0) return READOUTS.plain(accounts);
      return {
        text: `${Math.round(total(queue.map((a) => a.surplus)))}%`,
        tone: "warn",
        label: queue.slice(0, 2).map((a) => span(a.leftMs)).join("·"),
        burn: true,
      };
    },
  };

  const COLUMNS = {
    pool: { bar: "pool", readout: "both" },
    nest: { bar: "nest", readout: "plain" },
    nestboth: { bar: "nest", readout: "both" },
  };

  function row(accounts, column) {
    const spec = COLUMNS[column];
    const node = el("div", `r-row c-${column}`);
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);

    const lanes = el("span", "r-lanes");
    BARS[spec.bar](lanes, accounts);
    node.append(lanes);

    const state = READOUTS[spec.readout](accounts);
    const value = el("span", `r-val tone-${state.tone}`);
    value.textContent = state.text;
    node.append(value);
    const time = el("span", `r-tm${state.burn ? " burn" : ""}`);
    time.textContent = state.label;
    node.append(time);
    return node;
  }

  const STATES = [
    {
      caption: "your live Codex group · 86 % pinned, two spent",
      accounts: [at(0, 4.19 * DAY), at(86, 5.72 * DAY, true), at(0, 2.11 * DAY)],
    },
    {
      caption: "<b>two queued</b> · 78 expiring in 12 h, 71 in 24 h",
      accounts: [at(40, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)],
    },
    {
      caption: "<b>three queued</b> · 6 h, 18 h and 3 d",
      accounts: [at(40, 5 * DAY, true), at(90, 6 * HOUR), at(75, 18 * HOUR), at(80, 3 * DAY)],
    },
    {
      caption: "<b>cancellation</b> · one starving, one wasting",
      accounts: [at(10, 5.6 * DAY, true), at(90, 1.4 * DAY)],
    },
    {
      caption: "six accounts, three queued · 8 h, 30 h, 4 d",
      accounts: [at(40, 6 * DAY, true), at(85, 8 * HOUR), at(70, 30 * HOUR), at(78, 4 * DAY), at(0, 1 * DAY), at(20, 2 * DAY)],
    },
    {
      caption: "pinned nearly dry while two are queued",
      accounts: [at(5, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)],
    },
    {
      caption: "control · nothing at risk",
      accounts: [at(90, 6.5 * DAY, true), at(85, 6 * DAY), at(80, 5.5 * DAY)],
    },
  ];

  const FACTS = STATES.map((state) => {
    const queue = risky(state.accounts);
    return {
      queue: queue.map((a) => `${Math.round(a.surplus)} in ${span(a.leftMs)}`).join(" · ") || "none",
      pooled: Math.round(mean(state.accounts.map((a) => a.surplus))),
    };
  });

  window.QUOTA_ROUND28 = { STATES, FACTS, COLUMNS: Object.keys(COLUMNS), row };
})();
