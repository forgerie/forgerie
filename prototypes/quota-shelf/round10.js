/* Round 10: layers with a hue per meter, and four ways to draw pace.
 *
 * Pace is where an even spend would stand right now: the share of the window
 * still to run. Fill beyond it means the allowance is outlasting the clock,
 * fill short of it means the allowance runs out first.
 *
 *   ghost   the gap itself is drawn: a dim segment when ahead, a warm one
 *           when behind. Magnitude, not a mark.
 *   notch   a hairline cut out of the lane. Negative space, no added ink.
 *   track   the rail past the pace point is darker, so the boundary is a
 *           change in the lane's own ground rather than an object on it.
 *   pip     a small round mark inside the lane, never taller than it.
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

  /** The share of the window still to run. A window that states no length has
      no pace, and nothing is drawn for it. */
  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  function laneNode(lane, index, now, cooling, pace) {
    const fill = Math.max(0, Math.min(100, lane.remainingPercent));
    const mark = paceOf(lane, now);
    const behind = mark !== null && fill / 100 < mark;
    const row = el("span", `p-lane hue${index} tone-${toneOf(lane, now, cooling)}${behind ? " behind" : ""}`);
    row.style.setProperty("--fill", `${fill}%`);
    if (mark !== null) row.style.setProperty("--pace", `${mark * 100}%`);
    // The darkened ground goes under the fill: painted after it, it hides the
    // very level it is meant to give a boundary to.
    if (mark !== null && pace === "track") row.append(el("i", "p-track"));
    row.append(el("i", "p-fill"));

    if (mark !== null) {
      if (pace === "ghost") {
        const gap = el("i", "p-ghost");
        gap.style.left = `${Math.min(fill, mark * 100)}%`;
        gap.style.width = `${Math.abs(fill - mark * 100)}%`;
        row.append(gap);
      } else if (pace === "notch") {
        row.append(el("i", "p-notch"));
      } else if (pace === "pip") {
        row.append(el("i", "p-pip"));
      }
    }

    const state = mark === null
      ? "no pace: this pool states no window length"
      : behind
        ? `${Math.round(mark * 100 - fill)} points behind an even spend`
        : `${Math.round(fill - mark * 100)} points ahead of an even spend`;
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
    const rail = el("span", "p-wait");
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
    const { pace = "ghost" } = options;
    const root = el("div", `p pace-${pace}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const node = el("span", "p-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "");
        first = false;
        return node;
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const row = el("div", `p-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());

        const body = el("span", "p-body");
        for (const lane of account.lanes.filter(isUnmetered)) {
          const dot = el("i", `p-bool${lane.blocked ? " off" : ""}`);
          dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
          body.append(dot);
        }
        const stack = el("span", "p-stack");
        for (const [index, lane] of account.lanes.filter((item) => !isUnmetered(item)).entries()) {
          stack.append(laneNode(lane, index, now, cooling, pace));
        }
        body.append(stack);
        row.append(body);

        row.append(el("span", `p-val tone-${toneOf(binding, now, cooling)}`, value(binding)));
        row.append(el("span", `p-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      const row = el("div", "p-row dormant");
      row.title = dormant.map((account) => account.email).join("\n");
      row.append(tagFor());
      const body = el("span", "p-body");
      for (const account of dormant) body.append(waitBar(account, now));
      row.append(body);
      row.append(el("span", "p-val"));
      row.append(el("span", "p-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
      root.append(row);
    }
    return root;
  }

  window.QUOTA_ROUND10 = { shelf };
})();
