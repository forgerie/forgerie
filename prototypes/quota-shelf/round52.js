/* Round 52: height without collapse.
 *
 * Round 51 proved that no single line per provider answers all three
 * questions, because a collapse has to pick one of them. But the goal was
 * never one line per provider. The goal was height, and height is being
 * spent in places that carry no information:
 *
 *   lines        13 x 12   156 px   40%   the lanes -- information
 *   addresses     6 x 17   102 px   26%   labels
 *   row padding   4 x 14    56 px   15%   chrome
 *   account pad   7 x 8     56 px   15%   chrome
 *   lane gaps               24 px    6%
 *   row + shelf gaps        24 px    6%   chrome
 *
 * Only 40 per cent of the shelf is marks. And of those 13 lanes, ten are
 * healthy right now: a bar at some level with no cut crossed, no hatch, no
 * doom. Each costs exactly what a lane in trouble costs. A shelf whose job
 * is "is anything wrong" spends three-quarters of its height saying no.
 *
 * Three ways out, none of which averages anything:
 *
 *   dense   Every lane, every account, stripped of chrome. Rows are not
 *           cards; the tag column is the divider. Padding goes, gaps
 *           shrink to the lane pitch. Same 13 marks, about a third of the
 *           height.
 *
 *   triage  Healthy lanes are not drawn. What stays: any lane with trouble
 *           (doom, hatch, drained, refusing), and the routed account's
 *           binding lane, so "what can I spend now" always has a bar. The
 *           accounts not drawn are counted next to the tag. Height is
 *           proportional to trouble, not to roster size: a quiet shelf is
 *           four lines, a loud one is as tall as it needs to be.
 *
 *   tiled   Providers across, not down. Each gets a column and stacks its
 *           lanes inside it. Height is the tallest provider, not the sum.
 *           Trades width for height, and is honest about needing it.
 *
 * All three keep the lane geometry the nested shelf uses, so a mark means
 * the same thing here as there. `triage` is the one that changes the
 * contract: it draws by exception. That is the right contract for a glance
 * and the wrong one for an audit, and the shelf should say which it is
 * doing.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (v) => Math.max(0, Math.min(100, v));
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DOOM_MIN = 8;
  const DOOM_CAP = 8;

  function span(ms) {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  }

  const doomColour = (rate) => {
    if (!Number.isFinite(rate) || rate <= 1) return "var(--warn)";
    const near = Math.min(1, Math.log(rate) / Math.log(DOOM_CAP));
    return `color-mix(in oklab, var(--warn), var(--danger) ${Math.round(near * 100)}%)`;
  };

  const HUE = { five_hour: 0, antigravity_claude: 0, openrouter_key_limit: 0, seven_day: 1, antigravity_gpt_oss: 1, openrouter_credits: 1 };
  const laneHue = (id) => (id.startsWith("weekly_") ? 2 : (HUE[id] ?? 1));
  const isBoolean = (id) => id === "antigravity_gemini";

  function readLane(w, account, now) {
    const resetsAtMs = w.resetsAt ? Date.parse(w.resetsAt) : null;
    const windowMs = w.lengthSeconds ? w.lengthSeconds * 1000 : null;
    const leftMs = resetsAtMs === null ? null : resetsAtMs - now;
    const lane = {
      id: w.id, name: w.name, hue: laneHue(w.id), account,
      fill: clamp(w.remainingPercent),
      pace: windowMs && leftMs !== null && leftMs > 0 ? clamp((leftMs / windowMs) * 100) : null,
      amount: typeof w.remainingAmount === "number" ? w.remainingAmount : null,
      resetsAtMs, leftMs,
      boolean: isBoolean(w.id),
    };
    lane.refusing = lane.boolean && (!account.available || lane.fill <= 0);
    lane.drained = !lane.boolean && lane.amount === null && lane.fill <= 0;
    lane.doom = lane.pace !== null && lane.fill - lane.pace >= DOOM_MIN;
    lane.dry = lane.pace !== null && lane.fill < lane.pace && lane.fill > 0;
    lane.lowMoney = lane.amount !== null && lane.amount <= 2;
    /* Trouble is anything the nested shelf would colour. */
    lane.trouble = lane.refusing || lane.drained || lane.doom || lane.dry || lane.lowMoney || !account.available;
    return lane;
  }

  const money = (v) => (v <= 0 ? "$0" : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`);

  function meter(lane) {
    const bar = el("span", `d2-lane hue${lane.hue}`);
    bar.style.setProperty("--fill", `${lane.fill}%`);
    if (lane.pace === null) {
      bar.append(el("i", "d2-ground full"), el("i", "d2-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${lane.pace}%`);
    bar.append(el("i", "d2-ground left"), el("i", "d2-ground right"), el("i", "d2-fill left"));
    if (lane.fill > lane.pace) bar.append(el("i", "d2-fill right"));
    if (lane.dry) bar.append(el("i", "d2-hatch"));
    if (lane.doom) {
      const doom = el("i", "d2-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(lane.fill / lane.pace);
      bar.append(doom);
    }
    return bar;
  }

  function countdown(lane) {
    const node = el("span", "d2-tm");
    if (lane.resetsAtMs === null) { node.classList.add("none"); node.textContent = "—"; return node; }
    const text = span(lane.leftMs);
    if (lane.pace === null || lane.boolean) { node.textContent = text; return node; }
    if (lane.fill <= 0) { node.classList.add("dry"); node.append(el("i", "d2-glyph", "↓"), el("span", "", text)); return node; }
    if (lane.fill < lane.pace) {
      const pace = lane.pace / 100, spent = 100 - lane.fill;
      const elapsed = lane.leftMs * ((1 - pace) / pace);
      node.classList.add("dry"); node.append(el("i", "d2-glyph", "↓"), el("span", "", span(elapsed * (lane.fill / spent)))); return node;
    }
    if (lane.doom) { node.classList.add("loss"); node.append(el("i", "d2-glyph", "↑"), el("span", "", text)); return node; }
    node.textContent = text;
    return node;
  }

  function laneLine(lane) {
    const line = el("span", "d2-line");
    if (lane.boolean) {
      const slot = el("span", "d2-lane d2-roster");
      slot.append(el("i", `d2-token${lane.refusing ? " off" : ""}`));
      line.append(slot, countdown(lane));
      return line;
    }
    if (lane.amount !== null) {
      const slot = el("span", "d2-lane d2-value");
      slot.append(el("span", `d2-val${lane.amount <= 0 ? " out" : lane.lowMoney ? " low" : ""}`, money(lane.amount)));
      line.append(slot, countdown(lane));
      return line;
    }
    line.append(meter(lane), countdown(lane));
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };
  const tagOf = (p) => TAG[p.id] ?? p.id.slice(0, 2).toUpperCase();

  function accountLanes(account, now) {
    const lanes = account.windows.map((w) => readLane(w, account, now));
    return lanes.sort((a, b) => Number(a.boolean) - Number(b.boolean));
  }

  /** One account, every lane. */
  function block(account, lanes) {
    const node = el("span", `d2-acct${account.selected ? " routed" : ""}${account.available ? "" : " out"}`);
    node.title = account.email;
    for (const lane of lanes) node.append(laneLine(lane));
    return node;
  }

  /* ------------------------------------------------------------- dense */

  function denseRow(provider, now) {
    const row = el("div", "d2-row");
    row.append(el("span", "d2-tag", tagOf(provider)));
    const stack = el("span", "d2-stack");
    for (const account of provider.accounts) stack.append(block(account, accountLanes(account, now)));
    row.append(stack);
    return row;
  }

  /* ------------------------------------------------------------ triage */

  /**
   * Draw by exception. A lane is drawn if it is in trouble, or if it is the
   * routed account's binding lane. Everything else is counted.
   */
  function triageRow(provider, now) {
    const row = el("div", "d2-row");
    const routed = provider.accounts.find((a) => a.selected);
    const stack = el("span", "d2-stack");
    let hidden = 0;

    for (const account of provider.accounts) {
      const lanes = accountLanes(account, now);
      const keep = lanes.filter((lane) => lane.trouble);
      if (account === routed) {
        const metered = lanes.filter((l) => !l.boolean);
        const binding = metered.length ? metered.reduce((low, l) => (l.fill < low.fill ? l : low)) : lanes[0];
        if (binding && !keep.includes(binding)) keep.push(binding);
        keep.sort((a, b) => lanes.indexOf(a) - lanes.indexOf(b));
      }
      if (keep.length === 0) { hidden += 1; continue; }
      stack.append(block(account, keep));
    }

    const tag = el("span", "d2-tag", tagOf(provider));
    if (hidden > 0) {
      /* The accounts not drawn. Plain, because a hidden account is a healthy one. */
      tag.append(el("i", "d2-count", `+${hidden}`));
    }
    row.append(tag, stack);
    return row;
  }

  /* ------------------------------------------------------------- tiled */

  function tiledCol(provider, now) {
    const col = el("div", "d2-col");
    col.append(el("span", "d2-tag", tagOf(provider)));
    const stack = el("span", "d2-stack");
    for (const account of provider.accounts) stack.append(block(account, accountLanes(account, now)));
    col.append(stack);
    return col;
  }

  function shelf(root, payload, now, mode) {
    if (mode === "tiled") {
      const strip = el("div", "d2-tiles");
      for (const p of payload.providers) strip.append(tiledCol(p, now));
      root.append(strip);
      return;
    }
    const body = el("div", `d2-body is-${mode}`);
    for (const p of payload.providers) body.append(mode === "triage" ? triageRow(p, now) : denseRow(p, now));
    root.append(body);
  }

  /** A quiet shelf: everything healthy, so triage has almost nothing to draw. */
  function calm(payload, now) {
    return {
      ...payload,
      providers: payload.providers.map((p) => ({
        ...p,
        accounts: p.accounts.map((a) => ({
          ...a, available: true,
          windows: a.windows.map((w) => {
            if (isBoolean(w.id)) return { ...w, remainingPercent: 100 };
            if (typeof w.remainingAmount === "number") return { ...w, remainingAmount: 40, remainingPercent: 60 };
            const windowMs = (w.lengthSeconds ?? 0) * 1000;
            const leftMs = w.resetsAt ? Date.parse(w.resetsAt) - now : 0;
            const pace = windowMs && leftMs > 0 ? (leftMs / windowMs) * 100 : 50;
            return { ...w, remainingPercent: Math.round(clamp(pace + 3)) };
          }),
        })),
      })),
    };
  }

  window.QUOTA_ROUND52 = { shelf, calm, readLane };
})();
