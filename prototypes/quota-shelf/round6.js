/* Round 6: one line per account, no second state.
 *
 *   every window on the row   a rail each, sharing the row's width
 *   pace                      a stem above each rail at the even-spend mark:
 *                             fill short of the stem means burning faster
 *                             than the window refills
 *   Gemini                    a boolean, so a dot, never a percentage
 *   an empty account          has nothing to show but its return, so it
 *                             collapses to a half-height row, and several
 *                             empty accounts of one provider share it
 *
 * Two readings are rendered: rails with a label each, and rails bare. */

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
  const LABEL = { Gemini: "gem", Claude: "cla", "GPT-OSS": "gpt", Credits: "bal", "5 h": "5h", "7 d": "wk" };

  const value = (lane) =>
    typeof lane.remainingAmount === "number"
      ? `$${lane.remainingAmount.toFixed(2)}${lane.limitAmount ? `/${lane.limitAmount}` : ""}`
      : `${Math.round(lane.remainingPercent)}%`;

  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));

  /** Where an even spend would stand right now. Only a window that states its
      length can have one, so the Antigravity pools carry no stem and claim no
      pace they cannot measure. */
  function evenSpend(lane, now) {
    if (!lane.windowMs || lane.resetsAtMs === null) return null;
    const left = Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));
    return left;
  }

  function railFor(lane, now, cooling, labelled) {
    const tone = cooling ? "warn" : laneTone(lane, now);
    const cell = el("span", "s-lane");
    if (labelled) cell.append(el("b", "s-label", LABEL[lane.name] ?? lane.name));

    if (isUnmetered(lane)) {
      // A boolean has two states and no magnitude, so it gets a mark, not a
      // track: filled when the pool answers, hollow and red when it refuses.
      const dot = el("i", `s-bool tone-${lane.blocked ? "danger" : "ok"}${lane.blocked ? " off" : ""}`);
      dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
      cell.append(dot);
      return cell;
    }

    const rail = el("span", `s-rail tone-${tone}`);
    rail.style.setProperty("--fill", `${Math.max(0, Math.min(100, lane.remainingPercent))}%`);
    rail.append(el("i", "s-fill"));
    const pace = evenSpend(lane, now);
    if (pace !== null) {
      const stem = el("i", "s-pace");
      stem.style.left = `${pace * 100}%`;
      rail.append(stem);
    }
    rail.title = `${lane.name}: ${value(lane)} left, ${when(lane, now) || "no reset"}`;
    cell.append(rail);
    return cell;
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

  /** Empty means every metered lane is spent and nothing is answering. */
  const isDormant = (account) =>
    account.lanes.every((lane) => (isUnmetered(lane) ? lane.blocked : lane.remainingPercent <= 0));

  /** The soonest thing that changes: a cooldown, or the first window back. */
  function wakesIn(account, now) {
    const times = [];
    if (account.state === "cooling") times.push(account.coolingUntilMs - now);
    for (const lane of account.lanes) {
      if (isUnmetered(lane) && lane.blocked) times.push(lane.blockedUntilMs - now);
      else if (!isUnmetered(lane) && lane.resetsAtMs !== null) times.push(lane.resetsAtMs - now);
    }
    return Math.min(...times.filter((value) => Number.isFinite(value)));
  }

  function shelf(accounts, plan, now, labelled) {
    const root = el("div", `s${plan.bar ? "" : " no-bar"}${labelled ? " labelled" : ""}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const tone = cooling ? "warn" : laneTone(binding, now);
        const row = el("div", `s-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(el("span", "s-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
        first = false;
        const lanes = el("span", "s-lanes");
        for (const lane of account.lanes) lanes.append(railFor(lane, now, cooling, labelled && plan.width >= 300));
        row.append(lanes);
        row.append(el("span", `s-val tone-${tone}`, value(binding)));
        row.append(el("span", `s-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length > 0) {
        // Nothing here has a level. One half-height row carries the only fact
        // these accounts still hold: when each of them comes back.
        const row = el("div", "s-row dormant");
        row.title = dormant.map((account) => account.email).join("\n");
        row.append(el("span", "s-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
        const marks = el("span", "s-lanes");
        for (const account of dormant) marks.append(el("i", "s-sleep"));
        row.append(marks);
        row.append(el("span", "s-val"));
        row.append(el("span", "s-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
        root.append(row);
      }
    }
    return root;
  }

  window.QUOTA_ROUND6 = {
    labelled: (accounts, plan, now) => shelf(accounts, plan, now, true),
    bare: (accounts, plan, now) => shelf(accounts, plan, now, false),
  };
})();
