/* Round 11: give the pace mark a sign, and get the pip out of the track.
 *
 *   step     the lane is tall up to the pace point and thin after it. Fill
 *            running into the thin part is ahead; fill stopping inside the
 *            tall part is behind. The sign is the shape of the lane itself.
 *   deficit  the hairline notch stays, and only a shortfall is drawn: the
 *            stretch between the fill and the notch is hatched when behind,
 *            and nothing is added when ahead.
 *   wedge    a small triangle under the lane at the pace point, warm when
 *            behind, quiet when ahead. Below the lane, so it cannot read as a
 *            handle inside it.
 *   square   the same idea with a 2 px square, the plainest mark that still
 *            takes a colour.
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
    const row = el("span", `q-lane hue${index} tone-${toneOf(lane, now, cooling)}${behind ? " behind" : " ahead"}${pace === null ? " nopace" : ""}`);
    if (pace !== null) row.style.setProperty("--pace", `${pace}%`);
    row.style.setProperty("--fill", `${fill}%`);

    if (style === "step" && pace !== null) {
      // Two grounds and two fills: the lane is 4 px up to the pace point and
      // 2 px after it, so the fill's own thickness says which side it is on.
      const tallTrack = el("i", "q-ground tall");
      tallTrack.style.width = `${pace}%`;
      const thinTrack = el("i", "q-ground thin");
      thinTrack.style.left = `${pace}%`;
      thinTrack.style.right = "0";
      const tallFill = el("i", "q-fill tall");
      tallFill.style.width = `${Math.min(fill, pace)}%`;
      row.append(tallTrack, thinTrack, tallFill);
      if (fill > pace) {
        const thinFill = el("i", "q-fill thin");
        thinFill.style.left = `${pace}%`;
        thinFill.style.width = `${fill - pace}%`;
        row.append(thinFill);
      }
    } else {
      row.append(el("i", "q-ground full"), el("i", "q-fill flat"));
      if (pace !== null && style === "deficit") {
        if (behind) {
          const gap = el("i", "q-deficit");
          gap.style.left = `${fill}%`;
          gap.style.width = `${pace - fill}%`;
          row.append(gap);
        }
        row.append(el("i", "q-notch"));
      }
      if (pace !== null && style === "wedge") row.append(el("i", "q-wedge"));
      if (pace !== null && style === "square") row.append(el("i", "q-square"));
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
    const rail = el("span", "q-wait");
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
    const { style = "step" } = options;
    const root = el("div", `qq style-${style}`);
    for (const group of groups(accounts)) {
      const live = group.accounts.filter((account) => !isDormant(account));
      const dormant = group.accounts.filter(isDormant);
      let first = true;
      const tagFor = () => {
        const node = el("span", "q-tag", first ? TAG[group.provider] ?? group.provider.slice(0, 2) : "");
        first = false;
        return node;
      };

      for (const account of live) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const row = el("div", `q-row${account.routed ? " routed" : ""}`);
        row.title = account.email;
        row.append(tagFor());

        const body = el("span", "q-body");
        for (const lane of account.lanes.filter(isUnmetered)) {
          const dot = el("i", `q-bool${lane.blocked ? " off" : ""}`);
          dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
          body.append(dot);
        }
        const stack = el("span", "q-stack");
        for (const [index, lane] of account.lanes.filter((item) => !isUnmetered(item)).entries()) {
          stack.append(laneNode(lane, index, now, cooling, style));
        }
        body.append(stack);
        row.append(body);
        row.append(el("span", `q-val tone-${toneOf(binding, now, cooling)}`, value(binding)));
        row.append(el("span", `q-tm${cooling ? " tone-warn" : ""}`, cooling ? span(account.coolingUntilMs - now) : when(binding, now)));
        root.append(row);
      }

      if (dormant.length === 0) continue;
      const row = el("div", "q-row dormant");
      row.title = dormant.map((account) => account.email).join("\n");
      row.append(tagFor());
      const body = el("span", "q-body");
      for (const account of dormant) body.append(waitBar(account, now));
      row.append(body);
      row.append(el("span", "q-val"));
      row.append(el("span", "q-tm", dormant.map((account) => span(wakesIn(account, now))).join(" \u00b7 ")));
      root.append(row);
    }
    return root;
  }

  window.QUOTA_ROUND11 = { shelf };
})();
