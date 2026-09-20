/* Round 9: layers and ticks only, each meter identifiable without a word.
 *
 * No legend, no label column. Four ways to say which lane or which mark is
 * which, using shape rather than text:
 *
 *   layers-span   the lane's track is as long as its window is: the five-hour
 *                 lane is a short track, the weekly lanes run the full width,
 *                 and Fable, the heaviest allowance, takes the thickest lane
 *   layers-hue    one desaturated hue per meter, constant down the shelf
 *   ticks-shape   fill at the tightest meter; the others are marks with their
 *                 own shape: a dot, a stem, a square
 *   ticks-height  same, but the marks differ by height, short to tall, in the
 *                 account's own lane order, and pace hangs below the rail so
 *                 it can never be read as a meter
 *
 * Identity is by position in the account's lane list, which is stable for a
 * provider, so the same mark always means the same meter on the same row. */

(() => {
  const { isUnmetered, laneTone, bindingLane } = window.QUOTA_PLAN;
  const { span } = window.QUOTA_ROUND4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const TAG = { Antigravity: "AN", Claude: "CL", Codex: "CO", OpenRouter: "OP" };
  const DAY = 86_400_000;

  const value = (lane) =>
    typeof lane.remainingAmount === "number"
      ? `$${lane.remainingAmount.toFixed(2)}${lane.limitAmount ? `/${lane.limitAmount}` : ""}`
      : `${Math.round(lane.remainingPercent)}%`;

  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));
  const toneOf = (lane, now, cooling) => (cooling ? "warn" : laneTone(lane, now));
  const evenSpend = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  const describe = (lane, now) => `${lane.name}: ${value(lane)} left, ${when(lane, now) || "no reset"}`;

  /* --------------------------------------------------------------- layers */

  function layers(meters, now, cooling, scheme) {
    const block = el("span", "n-layers");
    for (const [index, lane] of meters.entries()) {
      // A lane as long as its window: a five-hour allowance is a short track,
      // a weekly one runs the full width. Scale says which meter this is
      // without naming it.
      const short = scheme === "span" && lane.windowMs !== null && lane.windowMs < DAY;
      const heavy = scheme === "span" && index === meters.length - 1 && meters.length > 2;
      const row = el("span", `n-layer tone-${toneOf(lane, now, cooling)}${short ? " short" : ""}${heavy ? " heavy" : ""}${scheme === "hue" ? ` hue${index}` : ""}`);
      row.style.setProperty("--fill", `${Math.max(0, Math.min(100, lane.remainingPercent))}%`);
      row.append(el("i"));
      row.title = describe(lane, now);
      block.append(row);
    }
    return block;
  }

  /* ---------------------------------------------------------------- ticks */

  function ticks(meters, now, cooling, scheme) {
    const tightest = meters.reduce((low, lane) => (lane.remainingPercent < low.remainingPercent ? lane : low));
    const rail = el("span", `n-ticks tone-${toneOf(tightest, now, cooling)}`);
    rail.style.setProperty("--fill", `${Math.max(0, Math.min(100, tightest.remainingPercent))}%`);
    rail.append(el("i", "n-fill"));
    for (const [index, lane] of meters.entries()) {
      if (lane === tightest) continue;
      const mark = el("i", `n-mark ${scheme === "shape" ? `shape${index}` : `tall${index}`}`);
      mark.style.left = `${Math.max(0, Math.min(100, lane.remainingPercent))}%`;
      mark.title = describe(lane, now);
      rail.append(mark);
    }
    const pace = evenSpend(tightest, now);
    if (pace !== null) {
      // Pace hangs below the rail. Above the rail is where meters live, and a
      // mark that means something else must not share that side.
      const stem = el("i", "n-pace");
      stem.style.left = `${pace * 100}%`;
      rail.append(stem);
    }
    rail.title = describe(tightest, now);
    return rail;
  }

  const DRAW = {
    "layers-span": (meters, now, cooling) => layers(meters, now, cooling, "span"),
    "layers-hue": (meters, now, cooling) => layers(meters, now, cooling, "hue"),
    "ticks-shape": (meters, now, cooling) => ticks(meters, now, cooling, "shape"),
    "ticks-height": (meters, now, cooling) => ticks(meters, now, cooling, "height"),
  };

  /* ----------------------------------------------------------------- rows */

  const isDormant = (account) =>
    account.lanes.every((lane) => (isUnmetered(lane) ? lane.blocked : lane.remainingPercent <= 0));

  function wakesIn(account, now) {
    const times = [];
    if (account.state === "cooling") times.push(account.coolingUntilMs - now);
    for (const lane of account.lanes) {
      if (isUnmetered(lane) && lane.blocked) times.push(lane.blockedUntilMs - now);
      else if (!isUnmetered(lane) && lane.resetsAtMs !== null) times.push(lane.resetsAtMs - now);
    }
    return Math.min(...times.filter(Number.isFinite));
  }

  function waitBar(account, now) {
    const rail = el("span", "n-wait");
    const lane = account.lanes.find((item) => !isUnmetered(item) && item.windowMs) ?? null;
    const left = lane === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));
    rail.style.setProperty("--fill", left === null ? "18%" : `${left * 100}%`);
    rail.append(el("i"));
    rail.title = `back in ${span(wakesIn(account, now))}`;
    return rail;
  }

  function groups(accounts) {
    const order = [];
    const byProvider = new Map();
    for (const account of accounts) {
      if (!byProvider.has(account.provider)) { byProvider.set(account.provider, []); order.push(account.provider); }
      byProvider.get(account.provider).push(account);
    }
    return order.map((provider) => ({ provider, accounts: byProvider.get(provider) }));
  }

  function shelf(accounts, plan, now, options = {}) {
    const { treatment = "layers-span" } = options;
    const draw = DRAW[treatment];
    const root = el("div", `n mode-${treatment}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const node = el("span", "n-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "");
        first = false;
        return node;
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const meters = account.lanes.filter((lane) => !isUnmetered(lane));
        const row = el("div", `n-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());

        const body = el("span", "n-body");
        for (const lane of account.lanes.filter(isUnmetered)) {
          const dot = el("i", `n-bool${lane.blocked ? " off" : ""}`);
          dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
          body.append(dot);
        }
        body.append(draw(meters, now, cooling));
        row.append(body);
        row.append(el("span", `n-val tone-${toneOf(binding, now, cooling)}`, value(binding)));
        row.append(el("span", `n-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      const row = el("div", "n-row dormant");
      row.title = dormant.map((account) => account.email).join("\n");
      row.append(tagFor());
      const body = el("span", "n-body");
      for (const account of dormant) body.append(waitBar(account, now));
      row.append(body);
      row.append(el("span", "n-val"));
      row.append(el("span", "n-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
      root.append(row);
    }
    return root;
  }

  window.QUOTA_ROUND9 = { shelf, DRAW };
})();
