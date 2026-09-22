/* Round 50: the whole shelf, consolidated.
 *
 * Thirty-five rounds of decisions, one file. This is not a new proposal --
 * it is what shipped, drawn from the live payload, so the prototype and the
 * plugin can be held against each other. Every constant here has the same
 * value it has in quota-shelf.js.
 *
 * The shelf answers three questions and refuses every other job:
 *
 *   what can I spend now          the fill
 *   what expires unspent          the solid bar past the pace cut
 *   what is draining too fast     the hatch, where fill falls short of it
 *
 * The rules underneath, and the round each was settled in:
 *
 *   nest, never pool (r28)
 *     A pooled bar's length is a mean, and every problem rounds 19 to 27
 *     hit came from that. Two accounts with equal and opposite overshoot
 *     average to a lane drawn exactly on pace while one of them is about to
 *     lose nearly everything. A single loss is divided by the account
 *     count. Two queued losses collapse into one. Nesting never averages,
 *     and costs the same up to three accounts.
 *
 *   an account is always a block
 *     Separating only accounts that own more than one lane made Codex's
 *     three one-meter accounts draw at the same pitch as Claude's three
 *     meters: the same picture for two different facts.
 *
 *   doom by rate, not deadline (r33)
 *     fill / pace is how many times the window's natural rate you must
 *     sustain to waste nothing. Unit-free, so it reads the same on a
 *     five-hour lane and a seven-day one. Sooner is not worse.
 *
 *   no pace from a passed reset (r48)
 *     Clamping to zero says "the window is over", which makes fill > pace
 *     true for every lane holding credit and paints a stale payload as a
 *     shelf-wide crisis.
 *
 *   the runway tick is redundant (r30)
 *     runway < timeLeft reduces to fill < pace, which is the hatch
 *     condition. Swept over 400,599 combinations, one disagreement, a
 *     rounding tie. No history reaches the shelf, so any rate computed from
 *     level, window and reset is a restatement of them.
 *
 *   width buys columns, height buys names (r42, r47)
 *     The lanes never move and never re-plot, so a mark learned in a narrow
 *     panel means the same thing in a wide one.
 *
 *   amber and red are the only saturated marks
 *     They always mean a problem with the quota. Health carries none, and
 *     doubt carries none either: a stale shelf that goes amber lies in the
 *     voice it uses to tell the truth.
 *
 *   the arrow, not the hue (r49)
 *     Amber against red is exactly the pair red-green colour blindness
 *     collapses, and the two states are opposite instructions.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));
  const unit = (value) => Math.max(0, Math.min(1, value));

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  /** One unit, always. Matches spanLabel in quota-data.js. */
  function span(ms) {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  }

  const DOOM_MIN_POINTS = 8;
  const DOOM_RATE_CAP = 8;

  const doomColour = (rate) => {
    if (!Number.isFinite(rate) || rate <= 1) return "var(--warn)";
    const near = Math.min(1, Math.log(rate) / Math.log(DOOM_RATE_CAP));
    return `color-mix(in oklab, var(--warn), var(--danger) ${Math.round(near * 100)}%)`;
  };

  const HUE = {
    five_hour: 0,
    antigravity_claude: 0,
    openrouter_key_limit: 0,
    seven_day: 1,
    antigravity_gpt_oss: 1,
    openrouter_credits: 1,
  };
  const laneHue = (id) => (id.startsWith("weekly_") ? 2 : (HUE[id] ?? 1));

  const isBoolean = (id) => id === "antigravity_gemini";

  function readLane(w, now) {
    const resetsAtMs = w.resetsAt ? Date.parse(w.resetsAt) : null;
    const windowMs = w.lengthSeconds ? w.lengthSeconds * 1000 : null;
    const leftMs = resetsAtMs === null ? null : resetsAtMs - now;
    return {
      id: w.id,
      name: w.name,
      hue: laneHue(w.id),
      fill: clamp(w.remainingPercent),
      /* Null, never zero: a reset in the past is the absence of a pace. */
      pace: windowMs && leftMs !== null && leftMs > 0 ? clamp((leftMs / windowMs) * 100) : null,
      amount: typeof w.remainingAmount === "number" ? w.remainingAmount : null,
      resetsAtMs,
      leftMs,
    };
  }

  const money = (v) => (v <= 0 ? "$0" : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`);

  function meter(lane) {
    const bar = el("span", `c-lane hue${lane.hue}`);
    bar.style.setProperty("--fill", `${lane.fill}%`);
    if (lane.pace === null) {
      bar.append(el("i", "c-ground full"), el("i", "c-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${lane.pace}%`);
    bar.append(el("i", "c-ground left"), el("i", "c-ground right"), el("i", "c-fill left"));
    if (lane.fill > lane.pace) bar.append(el("i", "c-fill right"));
    if (lane.fill < lane.pace && lane.fill > 0) bar.append(el("i", "c-hatch"));
    if (lane.fill - lane.pace >= DOOM_MIN_POINTS) {
      const doom = el("i", "c-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(lane.fill / lane.pace);
      bar.append(doom);
    }
    return bar;
  }

  /** Whichever fact lands first, and which kind of trouble it is. */
  function countdown(lane) {
    const node = el("span", "c-tm");
    if (lane.resetsAtMs === null) {
      node.classList.add("none");
      node.append(el("span", "c-num", "—"));
      return node;
    }
    const text = span(lane.leftMs);
    if (lane.pace === null || isBoolean(lane.id)) {
      node.append(el("span", "c-num", text));
      return node;
    }
    if (lane.fill <= 0) {
      node.classList.add("dry");
      node.append(el("i", "c-glyph", "↓"), el("span", "c-num", text));
      return node;
    }
    if (lane.fill < lane.pace) {
      const pace = lane.pace / 100;
      const spent = 100 - lane.fill;
      const elapsed = lane.leftMs * ((1 - pace) / pace);
      node.classList.add("dry");
      node.append(el("i", "c-glyph", "↓"), el("span", "c-num", span(elapsed * (lane.fill / spent))));
      return node;
    }
    if (lane.fill - lane.pace >= DOOM_MIN_POINTS) {
      node.classList.add("loss");
      node.append(el("i", "c-glyph", "↑"), el("span", "c-num", text));
      return node;
    }
    node.append(el("span", "c-num", text));
    return node;
  }

  function laneLine(lane, account) {
    const line = el("span", "c-line");
    line.append(el("span", "c-meter", lane.name));
    if (isBoolean(lane.id)) {
      const slot = el("span", "c-lane c-roster");
      slot.append(el("i", `c-token${account.available && lane.fill > 0 ? "" : " off"}`));
      line.append(slot, el("span", "c-pct"), countdown(lane));
      return line;
    }
    if (lane.amount !== null) {
      const slot = el("span", "c-lane c-value");
      slot.append(el("span", `c-val${lane.amount <= 0 ? " out" : lane.amount <= 2 ? " low" : ""}`, money(lane.amount)));
      line.append(slot, el("span", "c-pct"), countdown(lane));
      return line;
    }
    line.append(meter(lane), el("span", "c-pct", `${Math.round(lane.fill)}`), countdown(lane));
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  const drained = (account) =>
    account.windows.length > 0 && account.windows.every((w) => w.remainingPercent <= 0);

  function providerRow(provider, now, settings = {}) {
    const row = el("div", "c-row");
    row.append(el("span", "c-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    if (provider.accounts.length === 0) {
      row.append(el("span", "c-empty", "no accounts"));
      return row;
    }
    const stack = el("span", "c-stack");
    for (const account of provider.accounts) {
      const out = !account.available || drained(account);
      const block = el("span", `c-acct${account.selected ? " routed" : ""}${out ? " out" : ""}`);
      block.title = account.email;
      block.append(el("span", "c-who", account.email));

      const windows = account.windows.filter((w) => settings[w.id] !== false);
      if (windows.length === 0) {
        block.append(el("span", "c-empty", "no bars shown"));
        stack.append(block);
        continue;
      }
      /* The boolean last, under the lanes it belongs to. */
      const ordered = [...windows].sort((a, b) => Number(isBoolean(a.id)) - Number(isBoolean(b.id)));
      const lanes = el("span", "c-lanes");
      for (const w of ordered) lanes.append(laneLine(readLane(w, now), account));
      block.append(lanes);
      stack.append(block);
    }
    row.append(stack);
    return row;
  }

  function shelf(root, payload, now, { settings = {}, doubt = false, age = null, empty = false } = {}) {
    if (empty || payload.providers.length === 0) {
      root.append(el("p", "c-notice", "No providers configured."));
      return;
    }
    if (age !== null) root.append(el("p", "c-notice", `${span(age)} old`));
    const body = el("div", `c-body${doubt ? " doubt" : ""}`);
    for (const provider of payload.providers) body.append(providerRow(provider, now, settings));
    root.append(body);
  }

  /** Every reset moved into the past, as a stale payload looks. */
  const rot = (payload, now) => ({
    ...payload,
    providers: payload.providers.map((p) => ({
      ...p,
      accounts: p.accounts.map((a) => ({
        ...a,
        windows: a.windows.map((w) => ({ ...w, resetsAt: w.resetsAt ? new Date(now - MIN).toISOString() : null })),
      })),
    })),
  });

  const RUNGS = [
    { width: 300, gains: "lanes only" },
    { width: 430, gains: "+ clock" },
    { width: 510, gains: "+ level" },
    { width: 700, gains: "+ address" },
    { width: 860, gains: "+ meter name" },
  ];

  const POSTURES = [
    { id: "folded portrait", width: 475, height: 638 },
    { id: "folded landscape", width: 711, height: 374 },
    { id: "unfolded portrait", width: 704, height: 783 },
    { id: "unfolded landscape", width: 932, height: 553 },
  ];

  window.QUOTA_ROUND50 = { shelf, providerRow, rot, span, RUNGS, POSTURES, DOOM_MIN_POINTS, DOOM_RATE_CAP };
})();
