/* Round 5: the words come out.
 *
 * Every label round 4 printed is something the picture can carry instead:
 *
 *   ROUTED        a rail on the row's leading edge
 *   SPENT         an empty track, and a countdown instead of a zero
 *   cooling 12m   an amber track, and the cooldown in the time column
 *   spare         no mark at all: it is the absence of the routed rail
 *   open          a dashed track, because a dash is not a level
 *   blocked 12m   a dashed red track and the time it returns
 *   back 5d       just 5d, in the column that only ever holds time
 *   top-up        nothing: a balance with no reset leaves the column empty
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
  const SHORT = { Gemini: "Gem", Claude: "Claude", "GPT-OSS": "GPT", Credits: "credits", "5 h": "5h", "7 d": "week" };

  const value = (lane) =>
    typeof lane.remainingAmount === "number" ? `$${lane.remainingAmount.toFixed(2)}` : `${Math.round(lane.remainingPercent)}%`;

  /** Time is the only thing this column ever holds, so it needs no verb. An
      empty string is the honest entry for a balance that never resets. */
  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));

  function rail(lane, now, cooling) {
    const tone = cooling ? "warn" : laneTone(lane, now);
    if (isUnmetered(lane)) {
      const node = el("span", `r-rail dashed tone-${lane.blocked ? "danger" : "ok"}`);
      return node;
    }
    const node = el("span", `r-rail tone-${tone}`);
    node.append(el("i"));
    node.style.setProperty("--fill", `${Math.max(0, Math.min(100, lane.remainingPercent))}%`);
    return node;
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

  function collapsed(accounts, plan, now) {
    const root = el("div", `r rc${plan.bar ? "" : " no-bar"}`);
    for (const group of groups(accounts)) {
      for (const [index, account] of group.accounts.entries()) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const tone = cooling ? "warn" : laneTone(binding, now);
        const row = el("div", `r-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(el("span", "r-tag", index === 0 ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));

        const dots = el("span", "r-dots");
        for (const lane of account.lanes) {
          if (lane === binding && !cooling) continue;
          const dot = el("i", `r-dot tone-${laneTone(lane, now)}${isUnmetered(lane) ? " hollow" : ""}`);
          dot.title = `${lane.name}: ${isUnmetered(lane) ? (lane.blocked ? `blocked ${span(lane.blockedUntilMs - now)}` : "unmetered") : `${value(lane)}, ${when(lane, now) || "no reset"}`}`;
          dots.append(dot);
        }
        row.append(dots);

        if (plan.bar) row.append(rail(binding, now, cooling));
        row.append(el("span", `r-val tone-${tone}`, binding.remainingPercent <= 0 ? "" : value(binding)));
        row.append(el("span", `r-tm${cooling ? " tone-warn" : ""}`,
          cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }
    }
    return root;
  }

  function chip(lane, now) {
    const tone = laneTone(lane, now);
    const node = el("span", `r-chip tone-${tone}`);
    node.append(el("b", "r-chip-name", SHORT[lane.name] ?? lane.name));
    if (isUnmetered(lane)) {
      node.append(el("span", `r-rail dashed short tone-${lane.blocked ? "danger" : "ok"}`));
      if (lane.blocked) node.append(el("span", "r-chip-tm", span(lane.blockedUntilMs - now)));
      node.title = `${lane.name}: ${lane.blocked ? `blocked, back ${span(lane.blockedUntilMs - now)}` : "unmetered, open"}`;
      return node;
    }
    if (lane.remainingPercent > 0) node.append(el("span", "r-chip-val", value(lane)));
    node.append(el("span", "r-chip-tm", when(lane, now)));
    node.title = `${lane.name}: ${value(lane)} left, ${when(lane, now) || "no reset"}`;
    return node;
  }

  function expanded(accounts, plan, now) {
    const root = el("div", "r re");
    for (const group of groups(accounts)) {
      const block = el("div", "r-group");
      for (const [index, account] of group.accounts.entries()) {
        const row = el("div", `r-arow${account.routed ? " routed" : ""}${account.state === "spent" ? " spent" : ""}`);
        row.title = account.email;
        row.append(el("span", "r-tag", index === 0 ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
        const chips = el("span", "r-chips");
        for (const lane of account.lanes) chips.append(chip(lane, now));
        row.append(chips);
        block.append(row);
      }
      root.append(block);
    }
    return root;
  }

  window.QUOTA_ROUND5 = { collapsed, expanded };
})();
