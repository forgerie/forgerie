/* Round 23: the pooled bar with a readout you can actually spend.
 *
 * Round 22 read badly on live figures — 29 % and 2d in amber, where the
 * shipped shelf says 86 % and 6d in plain grey. I blamed the bar. That was
 * wrong: the bar was never the thing that changed the message. Three separate
 * choices were all taken from the pool, and only one of them had to be.
 *
 *   the fill      pooled. The group's total stock. This is the idea, and it
 *                 stays pooled.
 *   the number    pooled. Wrong. You cannot spend an average. The number
 *                 should name the account you would actually be routed to.
 *   the tone      pooled. Wrong, and it is why the live row turned amber:
 *                 28.7 % is under the warn threshold while the account in
 *                 hand holds 86 %.
 *   the hatch     pooled. Being behind an even spend "on average" is not a
 *                 problem while one account can still serve the request.
 *
 * So three treatments over the same bar:
 *
 *   pooled   round 21 unchanged: everything from the pool
 *   reach    the bar stays pooled; the number, the countdown and the tone
 *            come from the reachable account, and the hatch appears only
 *            when no account is ahead of its own pace
 *   reachcut the same, and the cut comes from the reachable account too, so
 *            the mark and the number describe one thing
 *
 * For a group of one account every treatment collapses to the same row, which
 * is what keeps the bar's meaning consistent across the shelf: the bar is
 * always the group's stock, and for a single account the group is the
 * account. */

(() => {
  const { isUnmetered } = window.QUOTA_PLAN;
  const { span } = window.QUOTA_ROUND4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const TAG = { Antigravity: "AN", Claude: "CL", Codex: "CO", OpenRouter: "OP" };
  const HUE = {
    five_hour: 0, antigravity_claude: 0,
    seven_day: 1, antigravity_gpt_oss: 1, openrouter_credits: 1,
    seven_day_fable: 2,
  };

  const metered = (account) => account.lanes.filter((lane) => !isUnmetered(lane));
  const booleans = (account) => account.lanes.filter(isUnmetered);
  const clamp = (value) => Math.max(0, Math.min(100, value));
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

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

  const bindingOf = (account) => {
    const pools = metered(account);
    if (pools.length === 0) return null;
    return pools.reduce((low, lane) => (lane.remainingPercent < low.remainingPercent ? lane : low));
  };

  /**
   * The account a request would actually land on: the one with the most left
   * in its binding meter, among those that can still serve. Ties go to the
   * account the router has already pinned.
   */
  function reachable(accounts) {
    const live = accounts.filter((account) => {
      const pools = metered(account);
      if (pools.length === 0) return booleans(account).some((lane) => !lane.blocked);
      return pools.some((lane) => lane.remainingPercent > 0);
    });
    if (live.length === 0) return null;
    return live.reduce((best, account) => {
      const a = bindingOf(account);
      const b = bindingOf(best);
      if (a === null || b === null) return best;
      if (a.remainingPercent !== b.remainingPercent) return a.remainingPercent > b.remainingPercent ? account : best;
      return account.routed ? account : best;
    });
  }

  const wakesIn = (account, now) => {
    const times = account.lanes
      .map((lane) => (lane.blocked ? lane.blockedUntilMs - now : lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now))
      .filter(Number.isFinite);
    return times.length === 0 ? Infinity : Math.min(...times);
  };

  const toneOf = (share) => (share <= 0 ? "dead" : share < 10 ? "danger" : share < 30 ? "warn" : "ok");

  /** One pooled meter: the group's stock, its cut, and what expires unspent. */
  function lane(kind, accounts, now, mode) {
    const owners = ownersOf(accounts, kind);
    const fill = mean(owners.map((l) => clamp(l.remainingPercent)));
    const paces = owners.map((l) => paceOf(l, now));
    const known = paces.filter((value) => value !== null);
    const pooledPace = known.length === owners.length && known.length > 0 ? mean(known) * 100 : null;

    // The cut can come from the pool or from the account the number names.
    let pace = pooledPace;
    if (mode.cut === "reach") {
      const best = reachable(accounts);
      const own = best === null ? undefined : best.lanes.find((l) => l.id === kind.id);
      const ownPace = own === undefined ? null : paceOf(own, now);
      pace = ownPace === null ? pooledPace : ownPace * 100;
    }

    const risk = mean(owners.map((l, index) =>
      paces[index] === null ? 0 : Math.max(0, clamp(l.remainingPercent) - paces[index] * 100)));

    // A group is only "behind" when nothing in it is ahead of its own pace.
    // While one account still has slack, an average shortfall is not a fact
    // anyone can act on.
    const anyAhead = owners.some((l, index) =>
      paces[index] !== null && clamp(l.remainingPercent) >= paces[index] * 100);
    const behind = pace !== null && fill < pace && fill > 0 && (mode.hatch === "pool" || !anyAhead);

    const tone = mode.tone === "pool" ? toneOf(fill) : "ok";
    const node = el("span", `b-lane w-lane hue${HUE[kind.id] ?? 1} tone-${tone}${behind ? " behind" : ""}`);
    node.style.setProperty("--fill", `${fill}%`);
    if (pace === null) node.append(el("i", "w-ground full"), el("i", "w-fill flat"));
    else {
      node.style.setProperty("--pace", `${pace}%`);
      node.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
      if (fill > pace) node.append(el("i", "w-fill right"));
      if (behind) node.append(el("i", "w-hatch"));
    }
    if (risk >= 0.5) {
      const hollow = el("i", "b-void");
      hollow.style.left = `${Math.max(0, fill - risk)}%`;
      hollow.style.width = `${Math.min(fill, risk)}%`;
      node.append(hollow);
    }
    node.dataset["owners"] = String(owners.length);
    return node;
  }

  function markSeams(stack) {
    let previous = 0;
    for (const node of stack.children) {
      const owners = Number(node.dataset["owners"]);
      if (owners === previous) continue;
      previous = owners;
      for (let index = 1; index < owners; index += 1) {
        const mark = el("i", "b-riser");
        mark.style.left = `${(index / owners) * 100}%`;
        node.append(mark);
      }
    }
  }

  /** Pooled: the emptiest tank. Reach: the account you would be routed to. */
  function readout(accounts, now, mode) {
    const meters = kinds(accounts);
    if (mode.value === "reach") {
      const best = reachable(accounts);
      if (best !== null) {
        const binding = bindingOf(best);
        if (binding === null) return { text: "", tone: "ok", ms: wakesIn(best, now) };
        const text = typeof binding.remainingAmount === "number"
          ? `$${binding.remainingAmount.toFixed(2)}`
          : `${Math.round(binding.remainingPercent)}%`;
        return {
          text,
          tone: toneOf(binding.remainingPercent),
          ms: binding.resetsAtMs === null ? Infinity : binding.resetsAtMs - now,
        };
      }
      // Nothing can serve: the only fact left is when something returns.
      return { text: "0%", tone: "dead", ms: Math.min(...accounts.map((a) => wakesIn(a, now))) };
    }
    if (meters.length === 0) {
      const lead = accounts.find((a) => a.routed) ?? accounts[0];
      return { text: "", tone: "ok", ms: wakesIn(lead, now) };
    }
    let worst = null;
    for (const kind of meters) {
      const owners = ownersOf(accounts, kind);
      const share = mean(owners.map((l) => clamp(l.remainingPercent)));
      const money = owners.every((l) => typeof l.remainingAmount === "number")
        ? owners.reduce((sum, l) => sum + l.remainingAmount, 0) : null;
      const resets = owners.map((l) => (l.resetsAtMs === null ? Infinity : l.resetsAtMs - now));
      if (worst === null || share < worst.share) worst = { share, money, ms: Math.min(...resets) };
    }
    return {
      text: worst.money === null ? `${Math.round(worst.share)}%` : `$${worst.money.toFixed(2)}`,
      tone: toneOf(worst.share),
      ms: worst.ms,
    };
  }

  const MODES = {
    pooled: { value: "pool", tone: "pool", hatch: "pool", cut: "pool" },
    reach: { value: "reach", tone: "reach", hatch: "reach", cut: "pool" },
    reachcut: { value: "reach", tone: "reach", hatch: "reach", cut: "reach" },
  };

  function groupRow(group, now, treatment) {
    const mode = MODES[treatment];
    const row = el("div", "r-row");
    row.append(el("span", "r-tag", TAG[group.provider] ?? group.provider.slice(0, 2).toUpperCase()));

    const lanes = el("span", "r-lanes");
    const dots = el("span", "r-dots");
    for (const account of group.accounts) {
      for (const flag of booleans(account)) dots.append(el("i", `w-bool${flag.blocked ? " off" : ""}`));
    }
    if (dots.childElementCount > 0) lanes.append(dots);

    const meters = kinds(group.accounts);
    if (meters.length > 0) {
      const stack = el("span", "w-stack");
      for (const kind of meters) stack.append(lane(kind, group.accounts, now, mode));
      markSeams(stack);
      lanes.append(stack);
    }
    row.append(lanes);

    const state = readout(group.accounts, now, mode);
    row.append(el("span", `r-val tone-${state.tone}`, state.text));
    row.append(el("span", "r-tm", Number.isFinite(state.ms) ? span(state.ms) : ""));
    return row;
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

  function shelf(accounts, now, treatment) {
    const root = el("div", "w r");
    for (const group of groups(accounts)) root.append(groupRow(group, now, treatment));
    return root;
  }

  window.QUOTA_ROUND23 = { groupRow, shelf, reachable, TREATMENTS: Object.keys(MODES) };
})();
