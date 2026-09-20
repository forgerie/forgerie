/* Round 21: the risk bar, told how many accounts it is made of.
 *
 * Round 20 settled the arithmetic. One bar per meter, the fill pooled across
 * the group, and the part of that fill which expires unspent drawn hollow:
 *
 *     at risk = mean of max(0, fill_i - pace_i)
 *
 * taken per account and never netted, so a starving account can no longer
 * erase a wasting one. What the bar still could not say is how many accounts
 * the tank is made of. This round adds round 16's riser — a mark above the
 * bar at each account boundary, where no fill, cut or hollow edge can ever
 * land on it, so the bar itself stays one continuous run.
 *
 * Three things get tested that round 20 did not reach:
 *
 *   - the riser on a three-lane stack. Round 16 only proved it on a single
 *     lane, and the risers live in the 3 px gap between stacked lanes, which
 *     is exactly where they might crowd.
 *   - the whole shelf, not just Codex: booleans, money, and a meter with no
 *     window length all have to pass through the same row.
 *   - the size ladder, because this is now a candidate to ship.
 *
 * One honest gap is carried forward: an account whose provider states no
 * window length cannot have a pace, so its surplus is unknown and it
 * contributes nothing to the risk. Antigravity is that case. The bar under-
 * states rather than invents. */

(() => {
  const { isUnmetered, bindingLane, laneTone } = window.QUOTA_PLAN;
  const { span } = window.QUOTA_ROUND4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const TAG = { Antigravity: "AN", Claude: "CL", Codex: "CO", OpenRouter: "OP" };
  const HUE = {
    five_hour: 0,
    antigravity_claude: 0,
    seven_day: 1,
    antigravity_gpt_oss: 1,
    openrouter_credits: 1,
    seven_day_fable: 2,
  };

  const metered = (account) => account.lanes.filter((lane) => !isUnmetered(lane));
  const booleans = (account) => account.lanes.filter(isUnmetered);
  const clamp = (value) => Math.max(0, Math.min(100, value));
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  function wakesIn(account, now) {
    const times = account.lanes
      .map((lane) => (lane.blocked ? lane.blockedUntilMs - now : lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now))
      .filter(Number.isFinite);
    return times.length === 0 ? Infinity : Math.min(...times);
  }

  /** The meters the group holds, in the order the group states them. */
  function kinds(accounts) {
    const out = [];
    for (const account of accounts) {
      for (const lane of metered(account)) {
        if (!out.some((kind) => kind.id === lane.id)) out.push({ id: lane.id, name: lane.name });
      }
    }
    return out;
  }

  const ownersOf = (accounts, kind) => accounts
    .map((account) => account.lanes.find((lane) => lane.id === kind.id))
    .filter((lane) => lane !== undefined);

  /**
   * One pooled meter: the group's level, its even-spend cut, the part of the
   * level that expires unspent, and a riser per account boundary.
   */
  function riskLane(kind, accounts, now, options) {
    const owners = ownersOf(accounts, kind);
    const fill = mean(owners.map((lane) => clamp(lane.remainingPercent)));
    const paces = owners.map((lane) => paceOf(lane, now));
    const known = paces.filter((value) => value !== null);
    const pace = known.length === owners.length && known.length > 0 ? mean(known) * 100 : null;
    // Positive terms only, and only from owners that state a window, so the
    // reading is never inflated by a lane that cannot have a pace.
    const risk = mean(owners.map((lane, index) =>
      paces[index] === null ? 0 : Math.max(0, clamp(lane.remainingPercent) - paces[index] * 100)));

    const tone = fill <= 0 ? "dead" : fill < 10 ? "danger" : fill < 30 ? "warn" : "ok";
    const behind = pace !== null && fill < pace && fill > 0;
    const lane = el("span", `b-lane w-lane hue${HUE[kind.id] ?? 1} tone-${tone}${behind ? " behind" : ""}`);
    lane.title = `${kind.name}: ${Math.round(fill)}% of ${owners.length} account${owners.length === 1 ? "" : "s"}`
      + (risk >= 0.5 ? ` · ${Math.round(risk)} expiring unspent` : "");
    lane.style.setProperty("--fill", `${fill}%`);
    if (pace === null) lane.append(el("i", "w-ground full"), el("i", "w-fill flat"));
    else {
      lane.style.setProperty("--pace", `${pace}%`);
      lane.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
      if (fill > pace) lane.append(el("i", "w-fill right"));
      if (behind) lane.append(el("i", "w-hatch"));
    }

    if (risk >= 0.5) {
      const hollow = el("i", "b-void");
      hollow.style.left = `${Math.max(0, fill - risk)}%`;
      hollow.style.width = `${Math.min(fill, risk)}%`;
      lane.append(hollow);
    }

    // The seam marks are drawn by the caller, which knows whether this lane
    // has the same owner count as the one above it.
    lane.dataset["owners"] = String(owners.length);
    return lane;
  }

  /**
   * How many accounts the tank is made of, marked once rather than per lane.
   *
   * Every meter of a group is usually owned by the same accounts, so a riser
   * on each lane repeats one fact three times, and the repeats land in the
   * 3 px gaps between stacked lanes where they are unreadable anyway. The
   * mark goes on the first lane, and again only where a later lane is owned
   * by a different number of accounts.
   */
  function markSeams(stack, seam) {
    if (seam === "none") return;
    let previous = 0;
    for (const lane of stack.children) {
      const owners = Number(lane.dataset["owners"]);
      if (owners === previous) continue;
      previous = owners;
      for (let index = 1; index < owners; index += 1) {
        const mark = el("i", seam === "base" ? "b-under" : "b-riser");
        mark.style.left = `${(index / owners) * 100}%`;
        lane.append(mark);
      }
    }
  }

  /** The group's own readout: the emptiest tank, and when that tank grows. */
  function readout(accounts, now) {
    const meters = kinds(accounts);
    if (meters.length === 0) {
      const lead = accounts.find((account) => account.routed) ?? accounts[0];
      return { text: "", tone: "ok", ms: wakesIn(lead, now) };
    }
    let worst = null;
    for (const kind of meters) {
      const owners = ownersOf(accounts, kind);
      const share = mean(owners.map((lane) => clamp(lane.remainingPercent)));
      const money = owners.every((lane) => typeof lane.remainingAmount === "number")
        ? owners.reduce((sum, lane) => sum + lane.remainingAmount, 0)
        : null;
      const resets = owners.map((lane) => (lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now));
      if (worst === null || share < worst.share) worst = { share, money, ms: Math.min(...resets) };
    }
    return {
      text: worst.money === null ? `${Math.round(worst.share)}%` : `$${worst.money.toFixed(2)}`,
      tone: worst.share <= 0 ? "dead" : worst.share < 10 ? "danger" : worst.share < 30 ? "warn" : "ok",
      ms: worst.ms,
    };
  }

  function groupRow(group, now, options = { seam: "riser" }) {
    const row = el("div", "r-row");
    row.append(el("span", "r-tag", TAG[group.provider] ?? group.provider.slice(0, 2).toUpperCase()));

    const lanes = el("span", "r-lanes");
    const dots = el("span", "r-dots");
    for (const account of group.accounts) {
      for (const flag of booleans(account)) {
        const dot = el("i", `w-bool${flag.blocked ? " off" : ""}`);
        dot.title = `${flag.name}: ${flag.blocked ? "refusing" : "answering"}`;
        dots.append(dot);
      }
    }
    if (dots.childElementCount > 0) lanes.append(dots);

    const meters = kinds(group.accounts);
    if (meters.length > 0) {
      const stack = el("span", "w-stack");
      for (const kind of meters) stack.append(riskLane(kind, group.accounts, now, options));
      markSeams(stack, options.seam);
      lanes.append(stack);
    }
    row.append(lanes);

    const state = readout(group.accounts, now);
    row.append(el("span", `r-val tone-${state.tone}`, state.text));
    row.append(el("span", "r-tm", Number.isFinite(state.ms) ? span(state.ms) : ""));
    return row;
  }

  function groups(accounts) {
    const order = [];
    const byProvider = new Map();
    for (const account of accounts) {
      if (!byProvider.has(account.provider)) {
        byProvider.set(account.provider, []);
        order.push(account.provider);
      }
      byProvider.get(account.provider).push(account);
    }
    return order.map((provider) => ({ provider, accounts: byProvider.get(provider) }));
  }

  function shelf(accounts, now, options = { seam: "riser" }) {
    const root = el("div", "w r");
    for (const group of groups(accounts)) root.append(groupRow(group, now, options));
    return root;
  }

  /* ------------------------------------------------------------ fixtures */

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const NOW = window.QUOTA_FIXTURE.NOW;

  const lane = (o) => ({
    windowMs: null, remainingPercent: null, remainingAmount: null, limitAmount: null,
    resetsAtMs: null, metered: true, blocked: false, blockedUntilMs: null, lastBlockedMs: null, history: null, ...o,
  });
  const week = (percent, leftMs) => lane({ id: "seven_day", name: "7 d", windowMs: WEEK, remainingPercent: percent, resetsAtMs: NOW + leftMs });
  const five = (percent, leftMs) => lane({ id: "five_hour", name: "5 h", windowMs: 5 * HOUR, remainingPercent: percent, resetsAtMs: NOW + leftMs });
  const fable = (percent, leftMs) => lane({ id: "seven_day_fable", name: "Fable", windowMs: WEEK, remainingPercent: percent, resetsAtMs: NOW + leftMs });
  const account = (provider, lanes, routed = false) => ({
    provider, providerId: provider.toLowerCase(), email: "account", routed,
    state: routed ? "routed" : "standby", lanes,
  });

  const codex = (...pairs) => ({
    provider: "Codex",
    accounts: pairs.map(([percent, leftMs], index) => account("Codex", [week(percent, leftMs)], index === 0)),
  });

  const STATES = [
    { caption: "cancellation · 10 % with most of its window left, 90 % with little", group: codex([10, 0.8 * WEEK], [90, 0.2 * WEEK]) },
    { caption: "the live Codex group · 95, 0, 0", group: codex([95, 6 * DAY], [0, 4 * DAY], [0, 2.7 * DAY]) },
    { caption: "two · 100 and 0", group: codex([100, 4.5 * DAY], [0, 4.5 * DAY]) },
    { caption: "two · 50 and 50", group: codex([50, 4.5 * DAY], [50, 4.5 * DAY]) },
    { caption: "the bench left alone · 15 at 2d, 100 at 1d, 60 at 2h", group: codex([15, 2 * DAY], [100, 1 * DAY], [60, 2 * HOUR]) },
    { caption: "six accounts", group: codex([95, 6.5 * DAY], [85, 5.5 * DAY], [70, 4.5 * DAY], [55, 3.5 * DAY], [40, 2.5 * DAY], [25, 1.5 * DAY]) },
    { caption: "control · everything on pace, nothing at risk", group: codex([90, 6.5 * DAY], [85, 6 * DAY], [80, 5.5 * DAY]) },
  ];

  /* Two Claude accounts, three meters each: the case round 16 never drew.
     Every lane carries a riser, and the risers sit in the gaps between the
     stacked lanes. */
  const CLAUDE = {
    provider: "Claude",
    accounts: [
      account("Claude", [five(92, 40 * MIN), week(96, 6.5 * DAY), fable(38, 6.5 * DAY)], true),
      account("Claude", [five(40, 2 * HOUR), week(70, 4 * DAY), fable(12, 4 * DAY)]),
    ],
  };

  const gemini = (blocked) => lane({
    id: "antigravity_gemini", name: "Gemini", metered: false, blocked,
    blockedUntilMs: blocked ? NOW + 12 * MIN : null, resetsAtMs: NOW + 5 * HOUR,
  });
  const agClaude = (percent, leftMs) => lane({ id: "antigravity_claude", name: "Claude", remainingPercent: percent, resetsAtMs: NOW + leftMs });
  const agGpt = (percent, leftMs) => lane({ id: "antigravity_gpt_oss", name: "GPT-OSS", remainingPercent: percent, resetsAtMs: NOW + leftMs });
  const credits = (left, limit) => lane({
    id: "openrouter_credits", name: "Credits",
    remainingPercent: (left / limit) * 100, remainingAmount: left, limitAmount: limit, resetsAtMs: null,
  });

  /* The whole shelf. The second fixture is the same accounts with a five-hour
     window about to turn over unspent, so the hollow has something to say. */
  const SHELF_CALM = [
    account("Antigravity", [gemini(false), agClaude(3.9, 38 * HOUR), agGpt(3.9, 38 * HOUR)], true),
    account("Antigravity", [gemini(true), agClaude(0, 27 * HOUR), agGpt(0, 27 * HOUR)]),
    account("Claude", [five(85, 15 * MIN), week(96, 6.5 * DAY), fable(38, 6.5 * DAY)], true),
    account("Codex", [week(95, 6 * DAY)], true),
    account("Codex", [week(0, 4 * DAY)]),
    account("Codex", [week(0, 2.7 * DAY)]),
    account("OpenRouter", [credits(1.63, 10)], true),
  ];

  const SHELF_WASTING = [
    account("Antigravity", [gemini(false), agClaude(3.9, 38 * HOUR), agGpt(3.9, 38 * HOUR)], true),
    account("Antigravity", [gemini(true), agClaude(0, 27 * HOUR), agGpt(0, 27 * HOUR)]),
    account("Claude", [five(92, 40 * MIN), week(96, 6.5 * DAY), fable(38, 6.5 * DAY)], true),
    account("Codex", [week(95, 6 * DAY)], true),
    account("Codex", [week(100, 18 * HOUR)]),
    account("Codex", [week(60, 2 * HOUR)]),
    account("OpenRouter", [credits(1.63, 10)], true),
  ];

  window.QUOTA_ROUND21 = { groupRow, shelf, STATES, CLAUDE, SHELF_CALM, SHELF_WASTING, NOW };
})();
