/* Round 2: the same two fixes, but no taller than the shelf that ships today.
 *
 * Round 1 spent vertical room it had not earned: a provider heading, an
 * account heading, and a row per lane is three lines before a single number
 * appears. These four renderings are measured against a faithful replica of
 * the current shelf, at the same width, with the same fixture.
 *
 * The replica copies the shipped paddings and font sizes out of
 * cliproxyapi-nix/forgerie-plugin/cliproxyapi-quota/quota-shelf.js, so the
 * height comparison is against the real thing rather than an impression. */

(() => {
  const { duration, isUnmetered, laneTone, bindingLane, laneValue } = window.QUOTA_PLAN;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const localPart = (email) => (email.includes("@") ? email.split("@")[0] : email);
  const whoText = (account, plan) => (plan.width >= 330 ? account.email : localPart(account.email));
  // One row has to hold identity, a level, a number and a reset. The domain is
  // the part that distinguishes least: every local part in this fixture is
  // already unique, and the provider tag disambiguates the rest.
  const shortWho = (account) => localPart(account.email);

  const stateOf = (account) =>
    account.state === "cooling" ? { cls: "cooling", text: "cooling" }
      : account.state === "spent" ? { cls: "spent", text: "spent" }
        : account.routed ? { cls: "routed", text: "routed" }
          : { cls: "", text: "standby" };

  const resetText = (lane, now) => (lane.resetsAtMs === null ? "top-up" : duration(lane.resetsAtMs - now));

  function track(percent, tone, cls = "") {
    const node = el("span", `track tone-${tone} ${cls}`);
    node.append(el("i"));
    node.style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
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

  /* ------------------------------------------------------------- 0 · today
     The shipped shelf, replicated: provider heading, account heading, one row
     per lane, shorter windows nested as a half-weight bar under the longer
     one. Gemini currently prints AVAILABLE against a full-width green track,
     which is the thing being fixed. */
  function today(accounts, plan, now) {
    const root = el("div", "t0");
    for (const group of groups(accounts)) {
      root.append(el("div", "t0-provider", group.provider));
      for (const account of group.accounts) {
        const head = el("div", "t0-acct");
        head.append(el("span", "t0-email", account.email));
        head.append(el("span", `t0-tag ${stateOf(account).cls}`, account.routed ? "routed" : stateOf(account).text));
        root.append(head);
        // Claude and Codex nest their short window inside the long one; the
        // Antigravity pools state no length, so each keeps its own row.
        const rows = account.lanes.length > 1 && account.lanes.every((lane) => lane.windowMs)
          ? [{ lead: account.lanes[account.lanes.length - 1], nested: account.lanes.slice(0, -1) }]
          : account.lanes.map((lane) => ({ lead: lane, nested: [] }));
        for (const { lead, nested } of rows) {
          const row = el("div", "t0-row");
          row.append(el("span", "t0-name", lead.name));
          const bars = el("span", "t0-bars");
          bars.append(track(isUnmetered(lead) ? 100 : lead.remainingPercent, laneTone(lead, now)));
          for (const inner of nested) bars.append(track(inner.remainingPercent, laneTone(inner, now), "quiet"));
          row.append(bars);
          row.append(el("span", `t0-pct num tone-${laneTone(lead, now)}`,
            isUnmetered(lead) ? (lead.blocked ? "EXHAUSTED" : "AVAILABLE") : `${Math.round(lead.remainingPercent)}%`));
          row.append(el("span", "t0-tm num", resetText(lead, now)));
          root.append(row);
        }
      }
    }
    return root;
  }

  /* ------------------------------------------------------------- E · trimmed
     Today's anatomy with the two heading lines removed. The provider becomes a
     tag on the account line, and the account line carries the binding lane's
     number, so identity and the headline fact share one row instead of two.
     Other lanes hang under it as single lines. */
  function trimmed(accounts, plan, now) {
    const root = el("div", "e");
    for (const account of accounts) {
      const binding = bindingLane(account);
      const tone = account.state === "cooling" ? "warn" : laneTone(binding, now);
      const card = el("div", "e-acct");

      const head = el("div", "e-head");
      head.append(el("span", "e-prov", account.provider.slice(0, 2).toUpperCase()));
      head.append(el("span", "who", whoText(account, plan)));
      if (account.state === "cooling") {
        head.append(el("span", "e-val num tone-warn", `cooling ${duration(account.coolingUntilMs - now)}`));
      } else if (binding) {
        head.append(el("span", `e-val num tone-${tone}`, laneValue(binding).text));
        head.append(el("span", "e-tm num", `\u21bb ${resetText(binding, now)}`));
      }
      card.append(head);

      for (const lane of account.lanes) {
        if (lane === binding && account.state !== "cooling") continue;
        const laneTone_ = laneTone(lane, now);
        const row = el("div", "e-lane");
        row.append(el("span", "e-name", lane.name));
        if (plan.bar) {
          row.append(isUnmetered(lane) ? el("span", "e-hollow") : track(lane.remainingPercent, laneTone_));
        }
        row.append(el("span", `e-val num ${isUnmetered(lane) ? "unmetered" : `tone-${laneTone_}`}`,
          isUnmetered(lane)
            ? (lane.blocked ? `blocked ${duration(lane.blockedUntilMs - now)}` : "unmetered")
            : laneValue(lane).text));
        row.append(el("span", "e-tm num", isUnmetered(lane) ? "" : `\u21bb ${resetText(lane, now)}`));
        card.append(row);
      }
      root.append(card);
    }
    return root;
  }

  /* --------------------------------------------------------------- F · oneline
     One row per account, full stop. The row states the lane that binds, its
     bar, its number and its reset; every other lane is a dot in a cluster,
     coloured by its own state. Detail is one tap away rather than always on,
     which is what buys the height back.

     An unmetered pool is a hollow ring in that cluster: present, named on
     hover, and never a level. */
  function oneline(accounts, plan, now) {
    const root = el("div", "f");
    for (const group of groups(accounts)) {
      for (const account of group.accounts) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const tone = cooling ? "warn" : laneTone(binding, now);
        const row = el("div", "f-row");
        row.append(el("span", "f-prov", account.provider.slice(0, 2).toUpperCase()));
        const who = el("span", "who", shortWho(account));
        who.title = account.email;
        row.append(who);

        const dots = el("span", "f-dots");
        for (const lane of account.lanes) {
          if (lane === binding && !cooling) continue;
          const dot = el("i", `f-dot tone-${laneTone(lane, now)}${isUnmetered(lane) ? " hollow" : ""}`);
          dot.title = isUnmetered(lane)
            ? `${lane.name}: ${lane.blocked ? `blocked, retry ${duration(lane.blockedUntilMs - now)}` : "unmetered, open"}`
            : `${lane.name}: ${laneValue(lane).text} left, resets ${resetText(lane, now)}`;
          dots.append(dot);
        }
        row.append(dots);

        if (plan.bar && binding) row.append(track(binding.remainingPercent, tone));
        row.append(el("span", `f-val num tone-${tone}`, cooling
          ? duration(account.coolingUntilMs - now)
          : laneValue(binding).text));
        row.append(el("span", "f-tm num", cooling ? "cooling" : `\u21bb ${resetText(binding, now)}`));
        root.append(row);
      }
    }
    return root;
  }

  /* --------------------------------------------------------------- G · routed
     One row per provider: the account the router actually sends work to, and
     what is left in it. Spare accounts collapse into a count that opens the
     full list. This is the smallest honest shelf: four rows for four
     providers, because a spare account is not a fact you act on until the
     routed one runs out. */
  function routedOnly(accounts, plan, now) {
    const root = el("div", "g");
    for (const group of groups(accounts)) {
      const lead = group.accounts.find((account) => account.routed) ?? group.accounts[0];
      const spares = group.accounts.length - 1;
      const binding = bindingLane(lead);
      const cooling = lead.state === "cooling";
      const tone = cooling ? "warn" : laneTone(binding, now);

      const row = el("div", "g-row");
      row.append(el("span", "g-prov", group.provider));
      if (plan.bar && binding) row.append(track(binding.remainingPercent, tone));
      row.append(el("span", `g-val num tone-${tone}`, laneValue(binding).text));
      row.append(el("span", "g-tm num", `\u21bb ${resetText(binding, now)}`));
      root.append(row);

      const sub = el("div", "g-sub");
      sub.append(el("span", "g-who", shortWho(lead)));
      const unmetered = lead.lanes.filter(isUnmetered);
      for (const lane of unmetered) {
        sub.append(el("span", `g-chip tone-${laneTone(lane, now)}`,
          lane.blocked ? `${lane.name} blocked ${duration(lane.blockedUntilMs - now)}` : `${lane.name} open`));
      }
      if (spares > 0) sub.append(el("span", "g-spare", `+${spares} spare`));
      root.append(sub);
    }
    return root;
  }

  window.QUOTA_ROUND2 = { today, e: trimmed, f: oneline, g: routedOnly };
})();
