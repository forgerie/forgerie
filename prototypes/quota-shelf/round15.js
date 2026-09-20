/* Round 15: the whole provider group on one row.
 *
 * Today the shelf spends a row per account and folds the drained ones into a
 * half-height row, so seven accounts cost six rows. This round asks what the
 * shelf looks like when a provider group — however many accounts it holds —
 * costs exactly one row.
 *
 * The thing that makes this hard is not the drawing, it is the promise the
 * shelf already made: a spare account that returns in a day has to stay
 * visible, or the shelf stops being a routing instrument. Five answers, in
 * the order of how much per-account fact they keep:
 *
 *   nest      every account keeps its own lane stack, nested in one row
 *   columns   every account keeps its stack, side by side, at 1/n the width
 *   segments  one lane per meter, cut lengthwise into one segment per account
 *   lead      the account in use drawn in full, the bench reduced to stubs
 *   pool      the group as one tank per meter, with ticks at the seams
 *
 * `today` is the shipped layout, built from the same helpers, so the height
 * comparison in the comp is honest rather than remembered.
 *
 * Two things hold across every treatment:
 *   - The leading slot is the account in use. Order carries it, not a word.
 *   - A drained account draws a wait bar, never an empty meter, because an
 *     empty meter under a pace cut hatches almost end to end and shouts.
 *
 * The lane geometry is round 14's, unchanged: same split pace cut, same hues,
 * same hatch. This round only rearranges. */

(() => {
  const { isUnmetered, bindingLane, laneTone } = window.QUOTA_PLAN;
  const { span } = window.QUOTA_ROUND4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const TAG = { Antigravity: "AN", Claude: "CL", Codex: "CO", OpenRouter: "OP" };

  /* Hue belongs to the meter, never to where the meter sits in the row. */
  const HUE = {
    five_hour: 0,
    antigravity_claude: 0,
    seven_day: 1,
    antigravity_gpt_oss: 1,
    openrouter_credits: 1,
    seven_day_fable: 2,
  };

  const metered = (account) => account.lanes.filter((lane) => !isUnmetered(lane));
  const booleans = (account) => account.lanes.filter(isUnmetered);

  /** The share of the window still to run. It is also the countdown, drawn. */
  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  /** Nothing left to spend: every meter is empty, or the only pool refuses. */
  function drained(account) {
    const pools = metered(account);
    if (pools.length > 0) return pools.every((lane) => lane.remainingPercent <= 0);
    return booleans(account).every((lane) => lane.blocked);
  }

  function wakesIn(account, now) {
    const times = account.lanes
      .map((lane) => (lane.blocked ? lane.blockedUntilMs - now : lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now))
      .filter(Number.isFinite);
    return times.length === 0 ? Infinity : Math.min(...times);
  }

  const amount = (lane) =>
    typeof lane.remainingAmount === "number" ? `$${lane.remainingAmount.toFixed(2)}` : `${Math.round(lane.remainingPercent)}%`;

  /** One meter: ground, fill, and the split pace cut. Round 13's reading. */
  function laneEl(lane, now, hueId) {
    const fill = Math.max(0, Math.min(100, lane.remainingPercent));
    const mark = paceOf(lane, now);
    const pace = mark === null ? null : mark * 100;
    const behind = pace !== null && fill < pace && fill > 0;
    const node = el("span", `w-lane hue${HUE[hueId ?? lane.id] ?? 1} tone-${laneTone(lane, now)}${behind ? " behind" : ""}`);
    node.title = `${lane.name}: ${Math.round(fill)}% left`;
    node.style.setProperty("--fill", `${fill}%`);
    if (pace === null) {
      node.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return node;
    }
    node.style.setProperty("--pace", `${pace}%`);
    node.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) node.append(el("i", "w-fill right"));
    if (behind) node.append(el("i", "w-hatch"));
    return node;
  }

  /** A spent account is one bar of its own wait, draining toward its return. */
  function waitEl(account, now) {
    const node = el("span", "r-wait");
    const binding = bindingLane(account);
    const pace = binding === null ? null : paceOf(binding, now);
    node.title = `back in ${span(wakesIn(account, now))}`;
    // A window with no stated length cannot claim a proportion, so it gets a
    // stub that says "waiting" and nothing more.
    node.style.setProperty("--fill", pace === null ? "18%" : `${pace * 100}%`);
    node.append(el("i"));
    return node;
  }

  function dotEl(lane, now) {
    const dot = el("i", `w-bool${lane.blocked ? " off" : ""}`);
    dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
    return dot;
  }

  /** In use first, then the bench, then the spent. Position is the label. */
  function order(accounts) {
    const rank = (account) => (account.routed ? 0 : drained(account) ? 2 : 1);
    return [...accounts].sort((a, b) => rank(a) - rank(b));
  }

  const head = (accounts) => order(accounts)[0];

  /** The distinct meters the group holds, in the order the group states them. */
  function kinds(accounts) {
    const out = [];
    for (const account of accounts) {
      for (const lane of metered(account)) {
        if (!out.some((kind) => kind.id === lane.id)) out.push({ id: lane.id, name: lane.name });
      }
    }
    return out;
  }

  const dotsOf = (accounts, now) => {
    const dots = el("span", "r-dots");
    for (const account of accounts) for (const lane of booleans(account)) dots.append(dotEl(lane, now));
    return dots;
  };

  /** One account's own block: its booleans, then its meters or its wait. */
  function slotBody(account, now, target) {
    for (const lane of booleans(account)) target.append(dotEl(lane, now));
    if (drained(account)) {
      target.append(waitEl(account, now));
      return target;
    }
    const pools = metered(account);
    if (pools.length === 0) return target;
    const stack = el("span", "w-stack");
    for (const lane of pools) stack.append(laneEl(lane, now));
    target.append(stack);
    return target;
  }

  const TREATMENTS = {
    // Every account keeps its own lane stack; the row keeps one tag, one
    // number, one countdown. Nothing about a meter is lost, only the chrome
    // that used to repeat around it.
    nest(accounts, now) {
      const box = el("span", "r-lanes r-nest");
      for (const account of order(accounts)) {
        box.append(slotBody(account, now, el("span", `r-acct${account.routed ? " routed" : ""}`)));
      }
      return box;
    },

    // Height is the scarce axis here and width is the plentiful one, so the
    // accounts reflow across the width instead of down the panel. Each stack
    // keeps every lane; it only gets shorter along its length.
    columns(accounts, now) {
      const box = el("span", "r-lanes r-cols");
      for (const account of order(accounts)) {
        box.append(slotBody(account, now, el("span", `r-col${account.routed ? " routed" : ""}`)));
      }
      return box;
    },

    // One lane per meter, as though the group were a single account, cut into
    // one segment per account. Reading down tells you which meter; reading
    // across tells you which account. A boolean rides the head of its own
    // account's first segment, so the mark and the column agree.
    segments(accounts, now) {
      const list = order(accounts);
      const box = el("span", "r-lanes");
      const stack = el("span", "w-stack");
      const meters = kinds(list);
      for (const [index, kind] of meters.entries()) {
        const lane = el("span", "r-seg");
        for (const account of list) {
          const cell = el("span", "r-cell");
          if (index === 0) for (const flag of booleans(account)) cell.append(dotEl(flag, now));
          const own = account.lanes.find((candidate) => candidate.id === kind.id);
          if (own === undefined) cell.append(el("i", "r-void"));
          else if (drained(account)) cell.append(waitEl(account, now));
          else cell.append(laneEl(own, now));
          lane.append(cell);
        }
        stack.append(lane);
      }
      box.append(stack);
      return box;
    },

    // The account actually carrying the work is drawn exactly as it is today.
    // The bench behind it shrinks to one stub each: how much it holds, or how
    // long until it holds anything.
    lead(accounts, now) {
      const list = order(accounts);
      const box = slotBody(list[0], now, el("span", "r-lanes r-lead"));
      for (const account of list.slice(1)) {
        const stub = el("span", "r-stub");
        if (drained(account)) stub.append(waitEl(account, now));
        else {
          const binding = bindingLane(account);
          if (binding === null) stub.append(el("i", "r-void"));
          else {
            const bar = el("span", `w-lane hue${HUE[binding.id] ?? 1} tone-${laneTone(binding, now)}`);
            bar.style.setProperty("--fill", `${Math.max(0, Math.min(100, binding.remainingPercent))}%`);
            bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
            stub.append(bar);
          }
        }
        stub.title = drained(account) ? `spent, back in ${span(wakesIn(account, now))}` : "spare";
        box.append(stub);
      }
      return box;
    },

    // The group as one tank per meter: the accounts are fungible, so their
    // levels add up. A tick at each seam says how many accounts that tank is
    // made of, without saying which is which.
    pool(accounts, now) {
      const list = order(accounts);
      const box = el("span", "r-lanes");
      const dots = dotsOf(list, now);
      if (dots.childElementCount > 0) box.append(dots);
      const stack = el("span", "w-stack");
      for (const kind of kinds(list)) {
        const owners = list
          .map((account) => account.lanes.find((candidate) => candidate.id === kind.id))
          .filter((lane) => lane !== undefined);
        const fill = owners.reduce((sum, lane) => sum + Math.max(0, Math.min(100, lane.remainingPercent)), 0) / owners.length;
        const paces = owners.map((lane) => paceOf(lane, now)).filter((value) => value !== null);
        const pace = paces.length === owners.length && paces.length > 0
          ? (paces.reduce((sum, value) => sum + value, 0) / paces.length) * 100
          : null;
        const tone = fill <= 0 ? "dead" : fill < 10 ? "danger" : fill < 30 ? "warn" : "ok";
        const behind = pace !== null && fill < pace && fill > 0;
        const lane = el("span", `w-lane hue${HUE[kind.id] ?? 1} tone-${tone}${behind ? " behind" : ""}`);
        lane.title = `${kind.name}: ${Math.round(fill)}% of ${owners.length} account${owners.length === 1 ? "" : "s"}`;
        lane.style.setProperty("--fill", `${fill}%`);
        if (pace === null) lane.append(el("i", "w-ground full"), el("i", "w-fill flat"));
        else {
          lane.style.setProperty("--pace", `${pace}%`);
          lane.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
          if (fill > pace) lane.append(el("i", "w-fill right"));
          if (behind) lane.append(el("i", "w-hatch"));
        }
        for (let seam = 1; seam < owners.length; seam += 1) {
          const tick = el("i", "r-tick");
          tick.style.setProperty("--at", `${(seam / owners.length) * 100}%`);
          lane.append(tick);
        }
        stack.append(lane);
      }
      box.append(stack);
      return box;
    },
  };

  /* The number and the countdown have to say the same thing the bars say.
     Four treatments draw the account in use, so they read it; `pool` draws
     the whole tank, so it reads the tank and the next moment the tank grows. */
  const READOUTS = {
    lead(accounts, now) {
      const lead = head(accounts);
      const binding = bindingLane(lead) ?? undefined;
      const ms = binding === undefined
        ? wakesIn(lead, now)
        : binding.resetsAtMs === null ? Infinity : binding.resetsAtMs - now;
      return {
        text: binding === undefined ? "" : amount(binding),
        tone: binding === undefined ? "ok" : laneTone(binding, now),
        ms,
      };
    },
    pool(accounts, now) {
      const meters = kinds(accounts);
      if (meters.length === 0) return READOUTS.lead(accounts, now);
      // The tank that binds is the emptiest of the group's pooled meters, and
      // the countdown belongs to that same tank: the next moment it grows.
      let worst = null;
      for (const kind of meters) {
        const owners = accounts
          .map((account) => account.lanes.find((candidate) => candidate.id === kind.id))
          .filter((lane) => lane !== undefined);
        const share = owners.reduce((sum, lane) => sum + Math.max(0, Math.min(100, lane.remainingPercent)), 0) / owners.length;
        const money = owners.every((lane) => typeof lane.remainingAmount === "number")
          ? owners.reduce((sum, lane) => sum + lane.remainingAmount, 0)
          : null;
        const resets = owners.map((lane) => (lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now));
        if (worst === null || share < worst.share) worst = { share, money, ms: Math.min(...resets) };
      }
      return {
        text: worst.money === null ? `${Math.round(worst.share)}%` : `$${worst.money.toFixed(2)}`,
        tone: worst.share <= 0 ? "dead" : worst.share < 10 ? "danger" : worst.share < 30 ? "warn" : "ok",
        ms: worst.ms,
      };
    },
  };

  function groupRow(group, now, treatment) {
    const readout = (READOUTS[treatment] ?? READOUTS.lead)(group.accounts, now);
    const row = el("div", "r-row");
    row.append(el("span", "r-tag", TAG[group.provider] ?? group.provider.slice(0, 2).toUpperCase()));
    row.append(TREATMENTS[treatment](group.accounts, now));
    row.append(el("span", `r-val tone-${readout.tone}`, readout.text));
    row.append(el("span", "r-tm", Number.isFinite(readout.ms) ? span(readout.ms) : ""));
    return row;
  }

  /** The shipped layout, for scale: a row per live account, drained folded. */
  function todayRows(group, now) {
    const rows = [];
    const live = group.accounts.filter((account) => !drained(account));
    const spent = group.accounts.filter(drained);
    let leading = true;
    for (const account of live) {
      const binding = bindingLane(account) ?? undefined;
      const row = el("div", `r-row${account.routed ? " routed" : ""}`);
      row.append(el("span", "r-tag", leading ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
      row.append(slotBody(account, now, el("span", "r-lanes")));
      row.append(el("span", `r-val tone-${binding === undefined ? "ok" : laneTone(binding, now)}`,
        binding === undefined ? "" : amount(binding)));
      const ms = binding === undefined
        ? wakesIn(account, now)
        : binding.resetsAtMs === null ? Infinity : binding.resetsAtMs - now;
      row.append(el("span", "r-tm", Number.isFinite(ms) ? span(ms) : ""));
      rows.push(row);
      leading = false;
    }
    if (spent.length > 0) {
      const row = el("div", "r-row r-half");
      row.append(el("span", "r-tag", leading ? TAG[group.provider] ?? group.provider.slice(0, 2) : ""));
      const lanes = el("span", "r-lanes");
      for (const account of spent) lanes.append(waitEl(account, now));
      row.append(lanes, el("span", "r-val"));
      row.append(el("span", "r-tm", spent.map((account) => span(wakesIn(account, now))).join(" · ")));
      rows.push(row);
    }
    return rows;
  }

  function groups(accounts) {
    const order = [];
    const byProvider = new Map();
    for (const account of accounts) {
      if (!byProvider.has(account.provider)) {
        byProvider.set(account.provider, []);
        order.push(account.provider);
      }
      byProvider.get(account.provider).push(account);
    }
    return order.map((provider) => ({ provider, accounts: byProvider.get(provider) }));
  }

  function shelf(accounts, now, treatment) {
    const root = el("div", `w r t-${treatment}`);
    for (const group of groups(accounts)) {
      if (treatment === "today") for (const row of todayRows(group, now)) root.append(row);
      else root.append(groupRow(group, now, treatment));
    }
    return root;
  }

  window.QUOTA_ROUND15 = { shelf, TREATMENTS: ["today", ...Object.keys(TREATMENTS)] };
})();
