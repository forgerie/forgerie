/* Round 8: three meters, one bar.
 *
 * An Anthropic account meters three things at once: the five-hour window, the
 * week, and Fable's own weekly allowance. Four ways to put all three into a
 * single bar instead of three rails:
 *
 *   layers    one block, a 2 px lane per meter, tightest at the top
 *   shade     one track, three fills over each other, the tightest brightest,
 *             so each meter shows as a step where its level ends
 *   ticks     one fill at the tightest meter, the others as stems on the rail
 *   segments  one track cut into a cell per meter, each cell filled by itself
 *
 * Each has to survive an account with one meter (Codex) and an account with a
 * boolean beside its meters (Antigravity). */

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
  const LABEL = { Gemini: "gem", Claude: "cla", "GPT-OSS": "gpt", Credits: "bal", "5 h": "5h", "7 d": "wk", Fable: "fab" };

  const value = (lane) =>
    typeof lane.remainingAmount === "number"
      ? `$${lane.remainingAmount.toFixed(2)}${lane.limitAmount ? `/${lane.limitAmount}` : ""}`
      : `${Math.round(lane.remainingPercent)}%`;

  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));

  const evenSpend = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null
      ? null
      : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  const toneOf = (lane, now, cooling) => (cooling ? "warn" : laneTone(lane, now));

  /* ----------------------------------------------------------- treatments */

  function barLayers(meters, now, cooling) {
    const block = el("span", "m-layers");
    for (const lane of meters) {
      const row = el("span", `m-layer tone-${toneOf(lane, now, cooling)}`);
      row.style.setProperty("--fill", `${Math.max(0, Math.min(100, lane.remainingPercent))}%`);
      row.append(el("i"));
      row.title = `${lane.name}: ${value(lane)}, ${when(lane, now)}`;
      block.append(row);
    }
    return block;
  }

  function barShade(meters, now, cooling) {
    const rail = el("span", "m-shade");
    // Widest first, so each narrower meter paints over it and its level reads
    // as the step where the brightness changes.
    const order = [...meters].sort((a, b) => b.remainingPercent - a.remainingPercent);
    for (const [index, lane] of order.entries()) {
      const fill = el("i", `m-step tone-${toneOf(lane, now, cooling)} s${index}`);
      fill.style.width = `${Math.max(0, Math.min(100, lane.remainingPercent))}%`;
      fill.title = `${lane.name}: ${value(lane)}, ${when(lane, now)}`;
      rail.append(fill);
    }
    return rail;
  }

  function barTicks(meters, now, cooling) {
    const tightest = meters.reduce((low, lane) => (lane.remainingPercent < low.remainingPercent ? lane : low));
    const rail = el("span", `m-ticks tone-${toneOf(tightest, now, cooling)}`);
    rail.style.setProperty("--fill", `${Math.max(0, Math.min(100, tightest.remainingPercent))}%`);
    rail.append(el("i", "m-fill"));
    for (const lane of meters) {
      if (lane === tightest) continue;
      const tick = el("i", "m-tick");
      tick.style.left = `${Math.max(0, Math.min(100, lane.remainingPercent))}%`;
      tick.title = `${lane.name}: ${value(lane)}, ${when(lane, now)}`;
      rail.append(tick);
    }
    const pace = evenSpend(tightest, now);
    if (pace !== null) {
      const stem = el("i", "m-pace");
      stem.style.left = `${pace * 100}%`;
      rail.append(stem);
    }
    return rail;
  }

  function barSegments(meters, now, cooling) {
    const block = el("span", "m-segments");
    for (const lane of meters) {
      const cell = el("span", `m-cell tone-${toneOf(lane, now, cooling)}`);
      cell.style.setProperty("--fill", `${Math.max(0, Math.min(100, lane.remainingPercent))}%`);
      cell.append(el("i"));
      cell.title = `${lane.name}: ${value(lane)}, ${when(lane, now)}`;
      block.append(cell);
    }
    return block;
  }

  const TREATMENTS = { layers: barLayers, shade: barShade, ticks: barTicks, segments: barSegments };

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
    const rail = el("span", "m-wait");
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
    const { treatment = "layers", labelled = false } = options;
    const draw = TREATMENTS[treatment];
    // The modifier is namespaced away from the bar classes: `m-shade` is the
    // bar itself, and reusing it on the root silently restyled the shelf.
    const root = el("div", `m mode-${treatment}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const node = el("span", "m-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "");
        first = false;
        return node;
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const meters = account.lanes.filter((lane) => !isUnmetered(lane));
        const booleans = account.lanes.filter(isUnmetered);

        const row = el("div", `m-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());

        const body = el("span", "m-body");
        for (const lane of booleans) {
          const dot = el("i", `m-bool${lane.blocked ? " off" : ""}`);
          dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
          body.append(dot);
        }
        if (labelled && plan.width >= 300) {
          body.append(el("b", "m-legend", meters.map((lane) => LABEL[lane.name] ?? lane.name).join(" ")));
        }
        body.append(draw(meters, now, cooling));
        row.append(body);

        row.append(el("span", `m-val tone-${toneOf(binding, now, cooling)}`, value(binding)));
        row.append(el("span", `m-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      const row = el("div", "m-row dormant");
      row.title = dormant.map((account) => account.email).join("\n");
      row.append(tagFor());
      const body = el("span", "m-body");
      for (const account of dormant) body.append(waitBar(account, now));
      row.append(body);
      row.append(el("span", "m-val"));
      row.append(el("span", "m-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
      root.append(row);
    }
    return root;
  }

  window.QUOTA_ROUND8 = { shelf, TREATMENTS };
})();
