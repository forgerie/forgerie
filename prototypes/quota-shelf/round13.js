/* Round 13: the pace tick, cut to match the bar's own geometry.
 *
 *   square   a 3 px straight slot, the round 12 reading
 *   rounded  the same slot with its corners rounded
 *   split    the lane is two pills with a gap at the pace point: ground and
 *            fill both break there, so every edge facing the gap is the same
 *            rounded cap the bar already ends with. The gap is visible
 *            whether the fill reaches the point or not.
 */

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

  const value = (lane) =>
    typeof lane.remainingAmount === "number"
      ? `$${lane.remainingAmount.toFixed(2)}${lane.limitAmount ? `/${lane.limitAmount}` : ""}`
      : `${Math.round(lane.remainingPercent)}%`;

  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));
  const toneOf = (lane, now, cooling) => (cooling ? "warn" : laneTone(lane, now));
  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  function laneNode(lane, index, now, cooling, style) {
    const fill = Math.max(0, Math.min(100, lane.remainingPercent));
    const mark = paceOf(lane, now);
    const pace = mark === null ? null : mark * 100;
    const behind = pace !== null && fill < pace;
    const row = el("span", `d-lane hue${index} tone-${toneOf(lane, now, cooling)}${behind ? " behind" : " ahead"}`);
    row.style.setProperty("--fill", `${fill}%`);
    if (pace !== null) row.style.setProperty("--pace", `${pace}%`);

    if (style === "split" && pace !== null) {
      row.append(el("i", "d-ground left"), el("i", "d-ground right"));
      row.append(el("i", "d-fill left"));
      if (fill > pace) row.append(el("i", "d-fill right"));
      if (behind) row.append(el("i", "d-hatch split"));
    } else {
      row.append(el("i", "d-ground full"), el("i", "d-fill flat"));
      if (behind) row.append(el("i", "d-hatch flat"));
      if (pace !== null) row.append(el("i", `d-notch${style === "rounded" ? " round" : ""}`));
    }

    const state = pace === null
      ? "no pace: this pool states no window length"
      : behind
        ? `${Math.round(pace - fill)} points behind an even spend`
        : `${Math.round(fill - pace)} points ahead of an even spend`;
    row.title = `${lane.name}: ${value(lane)} left, ${when(lane, now) || "no reset"} \u00b7 ${state}`;
    return row;
  }

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
    const rail = el("span", "d-wait");
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
    const { style = "split" } = options;
    const root = el("div", `dd cut-${style}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const node = el("span", "d-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "");
        first = false;
        return node;
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const row = el("div", `d-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());

        const body = el("span", "d-body");
        for (const lane of account.lanes.filter(isUnmetered)) {
          const dot = el("i", `d-bool${lane.blocked ? " off" : ""}`);
          dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
          body.append(dot);
        }
        const stack = el("span", "d-stack");
        for (const [index, lane] of account.lanes.filter((item) => !isUnmetered(item)).entries()) {
          stack.append(laneNode(lane, index, now, cooling, style));
        }
        body.append(stack);
        row.append(body);
        row.append(el("span", `d-val tone-${toneOf(binding, now, cooling)}`, value(binding)));
        row.append(el("span", `d-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      const row = el("div", "d-row dormant");
      row.title = dormant.map((account) => account.email).join("\n");
      row.append(tagFor());
      const body = el("span", "d-body");
      for (const account of dormant) body.append(waitBar(account, now));
      row.append(body);
      row.append(el("span", "d-val"));
      row.append(el("span", "d-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
      root.append(row);
    }
    return root;
  }

  window.QUOTA_ROUND13 = { shelf };
})();
