/* Round 3: one design in two states.
 *
 *   collapsed  one row per account, no address. The row states the lane that
 *              binds, and carries a dot for every other lane so nothing goes
 *              dark. A spare that comes back in a day is still a row.
 *   expanded   provider-led, and lossless: every window of every account,
 *              named, with its own number and its own reset. The address is
 *              still absent; the role (routed, spare, cooling) is what the
 *              reader acts on.
 *
 * The address moves to the row's tooltip rather than out of the product. */

(() => {
  const { duration, isUnmetered, laneTone, bindingLane, laneValue } = window.QUOTA_PLAN;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const resetText = (lane, now) => (lane.resetsAtMs === null ? "top-up" : duration(lane.resetsAtMs - now));

  /* Short lane names, because the name repeats on every row and the provider
     already said which service this is. */
  const SHORT = { Gemini: "Gem", Claude: "Claude", "GPT-OSS": "GPT", Credits: "credits", "5 h": "5h", "7 d": "7d" };
  const laneName = (lane) => SHORT[lane.name] ?? lane.name;

  function roleOf(account, now) {
    if (account.state === "cooling") return { text: `cooling ${duration(account.coolingUntilMs - now)}`, cls: "cooling" };
    if (account.routed) return { text: "routed", cls: "routed" };
    if (account.state === "spent") return { text: "spent", cls: "spent" };
    return { text: "spare", cls: "" };
  }

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

  /* ------------------------------------------------------------- collapsed */
  function collapsed(accounts, plan, now) {
    const root = el("div", `h${plan.bar ? "" : " no-bar"}`);
    for (const account of accounts) {
      const binding = bindingLane(account);
      const cooling = account.state === "cooling";
      const tone = cooling ? "warn" : laneTone(binding, now);
      const role = roleOf(account, now);

      const row = el("div", "h-row");
      // The address is the one fact a row can drop without losing meaning: the
      // provider and the role are what a routing decision is made from.
      row.title = account.email;
      row.append(el("span", "h-prov", account.provider));
      row.append(el("span", `h-role ${role.cls}`, role.text));

      const dots = el("span", "h-dots");
      for (const lane of account.lanes) {
        if (lane === binding && !cooling) continue;
        const dot = el("i", `h-dot tone-${laneTone(lane, now)}${isUnmetered(lane) ? " hollow" : ""}`);
        dot.title = isUnmetered(lane)
          ? `${lane.name}: ${lane.blocked ? `blocked, retry ${duration(lane.blockedUntilMs - now)}` : "unmetered, open"}`
          : `${lane.name}: ${laneValue(lane).text} left, resets ${resetText(lane, now)}`;
        dots.append(dot);
      }
      row.append(dots);

      if (plan.bar && binding) row.append(track(binding.remainingPercent, tone));
      row.append(el("span", `h-val num tone-${tone}`, laneValue(binding).text));
      row.append(el("span", "h-tm num", `\u21bb ${resetText(binding, now)}`));
      root.append(row);
    }
    return root;
  }

  /* -------------------------------------------------------------- expanded
     A window chip is the unit here: name, what is left, when it returns. Every
     window gets one, so the five-hour window and the pools are all readable
     without opening anything further, and a spare's reset is on the shelf
     where a plan can use it. */
  function windowChip(lane, now, plan) {
    const tone = laneTone(lane, now);
    const chip = el("span", `i-chip tone-${tone}`);
    chip.append(el("b", "i-chip-name", laneName(lane)));
    if (isUnmetered(lane)) {
      chip.append(el("span", "i-chip-val", lane.blocked ? `blocked ${duration(lane.blockedUntilMs - now)}` : "open"));
      chip.title = `${lane.name}: unmetered. The provider reports no level; the proxy's refusals are the only signal.`;
      return chip;
    }
    // A spent lane's percentage says nothing: zero is zero at every width.
    // The fact worth the space is when it comes back, so the chip trades one
    // readout for the other rather than dropping to a bare 0%.
    if (lane.remainingPercent <= 0) {
      chip.append(el("span", "i-chip-val", `back ${resetText(lane, now)}`));
      chip.title = `${lane.name}: empty, resets in ${resetText(lane, now)}`;
      return chip;
    }
    chip.append(el("span", "i-chip-val", laneValue(lane).text));
    if (plan.width >= 300) chip.append(el("span", "i-chip-tm", resetText(lane, now)));
    chip.title = `${lane.name}: ${laneValue(lane).text} left${laneValue(lane).exact ? ` ${laneValue(lane).exact}` : ""}, resets ${resetText(lane, now)}`;
    return chip;
  }

  function expanded(accounts, plan, now) {
    const root = el("div", `i${plan.bar ? "" : " no-bar"}`);
    for (const group of groups(accounts)) {
      const lead = group.accounts.find((account) => account.routed) ?? group.accounts[0];
      const binding = bindingLane(lead);
      const tone = lead.state === "cooling" ? "warn" : laneTone(binding, now);

      const head = el("div", "i-head");
      head.append(el("span", "i-prov", group.provider));
      if (plan.bar) head.append(track(binding.remainingPercent, tone));
      head.append(el("span", `i-val num tone-${tone}`, laneValue(binding).text));
      head.append(el("span", "i-tm num", `\u21bb ${resetText(binding, now)}`));
      root.append(head);

      for (const account of group.accounts) {
        const role = roleOf(account, now);
        const row = el("div", "i-acct");
        row.title = account.email;
        row.append(el("span", `i-role ${role.cls}`, role.text));
        const chips = el("span", "i-chips");
        for (const lane of account.lanes) chips.append(windowChip(lane, now, plan));
        row.append(chips);
        root.append(row);
      }
    }
    return root;
  }

  window.QUOTA_ROUND3 = { collapsed, expanded };
})();
