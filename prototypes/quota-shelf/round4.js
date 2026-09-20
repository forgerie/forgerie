/* Round 4: the same two states, quieted.
 *
 * Three sources of noise in round 3, each cut here:
 *
 *   colour      every healthy number was green, so the panel shouted even
 *               when nothing was wrong. Health is now plain: grey bar, plain
 *               text. Colour is reserved for amber and red, which makes a
 *               problem the only thing that stands out.
 *   repetition  the provider headline printed the routed account's number,
 *               and the chip under it printed the same number again. The
 *               headline is gone; the provider is a two-letter tag on the
 *               left rail of its group.
 *   ink         pills, the reset glyph, the word ROUTED on every row, and a
 *               decimal on every percentage. All dropped. A filled dot marks
 *               the routed account; only an exception gets a word.
 *
 * Times use one unit, never two: minutes under an hour, hours under two days,
 * days above that. */

(() => {
  const { isUnmetered, laneTone, bindingLane, laneValue } = window.QUOTA_PLAN;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const HOUR = 3_600_000;

  /** One unit, always. "45m", "38h", "3d". Two units read as precision that a
      countdown does not have. */
  function span(ms) {
    if (!Number.isFinite(ms)) return "\u2014";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  }

  const resetSpan = (lane, now) => (lane.resetsAtMs === null ? "top-up" : span(lane.resetsAtMs - now));

  const TAG = { Antigravity: "AN", Claude: "CL", Codex: "CO", OpenRouter: "OP" };
  // The long window is named "week", not "7d": a lane called 7d whose
  // countdown also reads 7d makes the reader parse which is which.
  const SHORT = { Gemini: "Gem", Claude: "Claude", "GPT-OSS": "GPT", Credits: "credits", "5 h": "5h", "7 d": "week" };

  /** Whole percent: a tenth of a percent is below the resolution of anything
      the reader can act on. Money keeps its cents. */
  function value(lane) {
    if (typeof lane.remainingAmount === "number") return `$${lane.remainingAmount.toFixed(2)}`;
    return `${Math.round(lane.remainingPercent)}%`;
  }

  function track(percent, tone) {
    const node = el("span", `qtrack tone-${tone}`);
    node.append(el("i"));
    node.style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
    return node;
  }

  /** Only an exception earns a word. A routed account earns a dot. */
  function mark(account, now) {
    if (account.state === "cooling") return { text: `cooling ${span(account.coolingUntilMs - now)}`, cls: "warn" };
    if (account.state === "spent") return { text: "spent", cls: "dead" };
    if (account.routed) return { text: "", cls: "routed", dot: true };
    return { text: "spare", cls: "dim" };
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
    const root = el("div", `q qc${plan.bar ? "" : " no-bar"}`);
    for (const group of groups(accounts)) {
      for (const [index, account] of group.accounts.entries()) {
        const binding = bindingLane(account);
        const cooling = account.state === "cooling";
        const tone = cooling ? "warn" : laneTone(binding, now);
        const flag = mark(account, now);

        const row = el("div", `q-row${flag.dot ? " routed" : ""}`);
        row.title = account.email;
        // The tag repeats only where it identifies: the first row of a
        // provider carries it, the rest of the group leaves the column empty.
        row.append(el("span", "q-tag", index === 0 ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
        // Routed is a rail on the row's edge, not a dot: the dots beside it
        // already mean "one lane", and two dot vocabularies in one row is the
        // kind of small ambiguity that reads as noise.
        row.append(el("span", `q-mark ${flag.cls}`, flag.text));

        const dots = el("span", "q-dots");
        for (const lane of account.lanes) {
          if (lane === binding && !cooling) continue;
          const dot = el("i", `q-dot tone-${laneTone(lane, now)}${isUnmetered(lane) ? " hollow" : ""}`);
          dot.title = isUnmetered(lane)
            ? `${lane.name}: ${lane.blocked ? `blocked, back ${span(lane.blockedUntilMs - now)}` : "unmetered, open"}`
            : `${lane.name}: ${value(lane)} left, back ${resetSpan(lane, now)}`;
          dots.append(dot);
        }
        row.append(dots);

        if (plan.bar && binding) row.append(track(binding.remainingPercent, tone));
        // A spent account already says "spent" and shows an empty rail. The
        // zero adds nothing, so the row keeps only the fact that moves: when
        // it comes back.
        const empty = binding.remainingPercent <= 0 && !isUnmetered(binding);
        row.append(el("span", `q-val tone-${tone}`, empty ? "" : value(binding)));
        row.append(el("span", "q-tm", resetSpan(binding, now)));
        root.append(row);
      }
    }
    return root;
  }

  /* -------------------------------------------------------------- expanded
     No provider headline: it only ever restated the first chip under it. The
     tag rides the left rail of the group instead, and every window of every
     account keeps its own number and its own return time. */
  function laneChip(lane, now) {
    const tone = laneTone(lane, now);
    const chip = el("span", `q-chip tone-${tone}`);
    chip.append(el("b", "q-chip-name", SHORT[lane.name] ?? lane.name));
    if (isUnmetered(lane)) {
      chip.append(el("span", "q-chip-val", lane.blocked ? `blocked ${span(lane.blockedUntilMs - now)}` : "open"));
      chip.title = `${lane.name}: unmetered. The provider reports no level, so the proxy's refusals are the only signal.`;
      return chip;
    }
    if (lane.remainingPercent <= 0) {
      chip.append(el("span", "q-chip-val", `back ${resetSpan(lane, now)}`));
      chip.title = `${lane.name}: empty, back in ${resetSpan(lane, now)}`;
      return chip;
    }
    chip.append(el("span", "q-chip-val", value(lane)));
    chip.append(el("span", "q-chip-tm", resetSpan(lane, now)));
    chip.title = `${lane.name}: ${value(lane)} left${laneValue(lane).exact ? ` ${laneValue(lane).exact}` : ""}, back in ${resetSpan(lane, now)}`;
    return chip;
  }

  function expanded(accounts, plan, now) {
    const root = el("div", "q qe");
    for (const group of groups(accounts)) {
      const block = el("div", "q-group");
      for (const [index, account] of group.accounts.entries()) {
        const flag = mark(account, now);
        const row = el("div", `q-arow${flag.dot ? " routed" : ""}`);
        row.title = account.email;
        row.append(el("span", "q-tag", index === 0 ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
        row.append(el("span", `q-mark ${flag.cls}`, flag.text));
        const chips = el("span", "q-chips");
        for (const lane of account.lanes) chips.append(laneChip(lane, now));
        row.append(chips);
        block.append(row);
      }
      root.append(block);
    }
    return root;
  }

  window.QUOTA_ROUND4 = { collapsed, expanded, span };
})();
