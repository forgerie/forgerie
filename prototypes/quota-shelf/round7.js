/* Round 7: two open questions, rendered rather than argued.
 *
 *   drained   an account with nothing left has one fact: when it returns. So
 *             it folds to a half-height row carrying a single bar, and that
 *             bar is the wait itself, draining toward the refill.
 *   boolean   Antigravity's Gemini answers or refuses. Four ways to put a
 *             two-state lane in a row of levels, side by side:
 *               dot        filled when answering, hollow red when refusing
 *               dash       a dashed rule: a track with nothing measured in it
 *               hatch      a full-width striped segment, texture instead of
 *                          fill, so it can never be read as 100 percent
 *               exception  nothing at all until it refuses, then a red mark
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
  const LABEL = { Gemini: "gem", Claude: "cla", "GPT-OSS": "gpt", Credits: "bal", "5 h": "5h", "7 d": "wk" };

  const value = (lane) =>
    typeof lane.remainingAmount === "number"
      ? `$${lane.remainingAmount.toFixed(2)}${lane.limitAmount ? `/${lane.limitAmount}` : ""}`
      : `${Math.round(lane.remainingPercent)}%`;

  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));

  const evenSpend = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null
      ? null
      : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  function booleanCell(lane, now, style) {
    const open = !lane.blocked;
    const title = `${lane.name}: ${open ? "answering" : `refusing, back ${span(lane.blockedUntilMs - now)}`}`;
    if (style === "exception" && open) {
      const spacer = el("i", "b-none");
      spacer.title = title;
      return spacer;
    }
    const node = el("i", `b-${style === "exception" ? "dot" : style} ${open ? "on" : "off"}`);
    node.title = title;
    return node;
  }

  function laneCell(lane, now, cooling, labelled, geminiStyle) {
    const cell = el("span", `s-lane${isUnmetered(lane) ? " boolean" : ""}`);
    if (labelled) cell.append(el("b", "s-label", LABEL[lane.name] ?? lane.name));
    if (isUnmetered(lane)) {
      cell.append(booleanCell(lane, now, geminiStyle));
      return cell;
    }
    const tone = cooling ? "warn" : laneTone(lane, now);
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

  /** The wait, drawn as itself: the bar holds what is left of it, so a nearly
      refilled account is nearly empty of bar. Windows that state no length
      cannot be scaled, so they show a fixed stub. */
  function waitBar(account, now) {
    const rail = el("span", "s-rail wait tone-dead");
    const lane = account.lanes.find((item) => !isUnmetered(item) && item.windowMs) ?? null;
    const left = lane === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));
    rail.style.setProperty("--fill", left === null ? "18%" : `${left * 100}%`);
    rail.append(el("i", "s-fill"));
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
    const { gemini = "dot", drained = "merged", labelled = true } = options;
    const root = el("div", `s s7${plan.bar ? "" : " no-bar"}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const text = first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "";
        first = false;
        return el("span", "s-tag", text);
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const tone = cooling ? "warn" : laneTone(binding, now);
        const row = el("div", `s-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());
        const lanes = el("span", "s-lanes");
        for (const lane of account.lanes) lanes.append(laneCell(lane, now, cooling, labelled && plan.width >= 300, gemini));
        row.append(lanes);
        row.append(el("span", `s-val tone-${tone}`, value(binding)));
        row.append(el("span", `s-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      if (drained === "merged") {
        const row = el("div", "s-row dormant");
        row.title = dormant.map((account) => account.email).join("\n");
        row.append(tagFor());
        const lanes = el("span", "s-lanes");
        for (const account of dormant) lanes.append(waitBar(account, now));
        row.append(lanes);
        row.append(el("span", "s-val"));
        row.append(el("span", "s-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
        root.append(row);
        continue;
      }
      for (const account of dormant) {
        const row = el("div", "s-row dormant");
        row.title = account.email;
        row.append(tagFor());
        const lanes = el("span", "s-lanes");
        lanes.append(waitBar(account, now));
        row.append(lanes);
        row.append(el("span", "s-val"));
        row.append(el("span", "s-tm", span(wakesIn(account, now))));
        root.append(row);
      }
    }
    return root;
  }

  window.QUOTA_ROUND7 = { shelf };
})();
