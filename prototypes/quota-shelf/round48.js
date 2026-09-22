/* Round 48: what the shelf says when it does not know.
 *
 * Every round so far has drawn a shelf that is certain. The payload is
 * present, fresh, and complete, and the bars are drawn with total
 * confidence. Three things break that, and none has ever been drawn:
 *
 *   stale     The payload carries updatedAt and nothing reads it. We
 *             already know from this project that payloads rot within about
 *             28 hours: the resets drift into the past, print "now", and
 *             the paces clamp to zero. A clamped pace is not a neutral
 *             value -- pace is the share of the window still to run, so a
 *             pace of zero means "the window is over", and fill > pace is
 *             then true for every lane with any credit left. The shelf
 *             lights up amber across the board and looks like a crisis. It
 *             is the most dangerous state on this list because it is the
 *             one that looks most like information.
 *   empty     No providers, or a provider with no accounts. A shelf with
 *             nothing in it currently renders as nothing at all, which is
 *             indistinguishable from a shelf that failed to render.
 *   error     The proxy is unreachable. The last good payload is either
 *             held and labelled, or discarded. Holding it is right --
 *             quota does not change much in a minute -- but only if the
 *             shelf says so.
 *
 * The rule the shelf already lives by decides all three. Amber and red are
 * the only saturated marks and they always mean a problem with the quota.
 * Not knowing is not a quota problem, so it cannot borrow those colours. A
 * stale shelf that goes amber is lying in exactly the same voice it uses to
 * tell the truth.
 *
 * So doubt is drawn by taking confidence away rather than by adding alarm:
 * the lanes fade toward the rail they sit on, and one line of plain grey
 * text says the age. Nothing on the shelf turns a colour it does not
 * already own.
 *
 * Three candidates for how far the fade goes, because the failure mode at
 * each end is real. Too subtle and a day-old shelf passes for a live one.
 * Too strong and a shelf that is merely a few minutes behind looks broken.
 */

(() => {
  const { readLane, next } = window.QUOTA_ROUND43;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const unit = (value) => Math.max(0, Math.min(1, value));
  const WARN = [210, 153, 34];
  const DANGER = [248, 81, 73];
  const CAP = 8;
  const AT_RISK = 8;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  /* A payload older than this is described rather than trusted. Chosen as
     the point where a five-hour window has turned over a third of its
     length, so at least one lane on this shelf is certainly wrong. */
  const STALE_AFTER = 90 * MIN;

  const doomColour = (near) =>
    `rgb(${WARN.map((from, i) => Math.round(from + (DANGER[i] - from) * near)).join(", ")})`;
  const urgency = (fill, pace) => {
    if (pace <= 0) return 1;
    const excess = fill / pace;
    return excess <= 1 ? 0 : unit(Math.log(excess) / Math.log(CAP));
  };

  /**
   * The real fix, and it is a bug rather than a style.
   *
   * round43.readLane computes `pace` as clamp((leftMs / windowMs) * 100),
   * and clamp floors at zero. So a reset that has already passed does not
   * produce "no pace", it produces a pace of exactly zero -- and zero is a
   * meaningful value on this axis. It means "the window is over", which
   * makes fill > pace true for every lane holding any credit, which paints
   * the whole shelf in the doom bar at full red.
   *
   * A reset in the past means the window has turned over and we know
   * nothing about the current one. That is not a pace of zero, it is the
   * absence of a pace, and the shelf has drawn that since round 33:
   * Antigravity states no window length, gets `pace: null`, and renders a
   * flat bar with no cut, no hatch and no doom.
   *
   * Routing the stale case into the existing null-pace path removes the
   * false crisis at the source rather than dimming it.
   */
  function readLaneStrict(window, now) {
    const lane = readLane(window, now);
    if (lane.leftMs !== null && lane.leftMs <= 0) return { ...lane, pace: null };
    return lane;
  }

  function age(ms) {
    if (ms < MIN) return "just now";
    if (ms < HOUR) return `${Math.round(ms / MIN)}m old`;
    if (ms < 2 * DAY) return `${Math.round(ms / HOUR)}h old`;
    return `${Math.round(ms / DAY)}d old`;
  }

  function meter(lane) {
    const bar = el("span", `a-lane w-lane hue${lane.hue} tone-ok`);
    bar.style.setProperty("--fill", `${lane.fill}%`);
    if (lane.pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${lane.pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (lane.fill > lane.pace) bar.append(el("i", "w-fill right"));
    if (lane.fill < lane.pace && lane.fill > 0) bar.append(el("i", "w-hatch"));
    if (lane.fill - lane.pace >= AT_RISK) {
      const doom = el("i", "a-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(urgency(lane.fill, lane.pace));
      bar.append(doom);
    }
    return bar;
  }

  const isBoolean = (lane) => lane.id === "antigravity_gemini";
  const isBalance = (lane) => lane.amount !== null;
  const money = (amount) => (amount <= 0 ? "$0" : amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`);

  function laneLine(lane, account) {
    const line = el("span", "a-line");
    line.append(el("span", "a-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "a-lane a-roster");
      strip.append(el("i", `a-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "a-pct"), el("span", "a-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "a-lane a-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `a-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "a-pct"), el("span", "a-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "a-pct", `${Math.round(lane.fill)}`),
      el("span", `a-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  function providerRow(provider, now, read = readLaneStrict) {
    const node = el("div", "a-row");
    node.append(el("span", "a-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));

    /* A provider that reports no accounts is a fact, not a blank. */
    if (provider.accounts.length === 0) {
      const stack = el("span", "a-stack");
      const block = el("span", "a-acct");
      block.append(el("span", "a-line", " ").appendChild(el("span", "a-none", "no accounts")).parentElement);
      stack.append(block);
      node.append(stack);
      return node;
    }

    const stack = el("span", `a-stack${needsGrouping(provider.accounts) ? " grouped" : ""}`);
    for (const account of provider.accounts) {
      const block = el("span", `a-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `a-who${account.available ? "" : " is-out"}`, account.email);
      who.title = account.email;
      block.append(who);
      const lanes = el("span", "a-lanes");
      const windows = [...account.windows].sort(
        (a, b) => Number(isBoolean(read(a, now))) - Number(isBoolean(read(b, now))),
      );
      for (const window of windows) lanes.append(laneLine(read(window, now), account));
      block.append(lanes);
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  /**
   * One line of plain grey text, never a colour the shelf uses for quota.
   * `tone` picks the wording, not the alarm level.
   */
  function banner(text) {
    return el("div", "a-banner", text);
  }

  /**
   * @param state  "live" | "stale" | "error" | "empty" | "loading"
   * @param fade   how far a doubtful shelf fades: "soft" | "half" | "ghost"
   */
  function shelf(root, payload, now, { state = "live", fade = "half", ageMs = 0, pacing = "strict" } = {}) {
    const read = pacing === "clamped" ? readLane : readLaneStrict;
    if (state === "loading") {
      root.append(banner("reading quota…"));
      return;
    }
    if (state === "empty") {
      /* Distinguishable from a shelf that failed to render, which is the
         whole point: "nothing here" is a different fact from "nothing
         happened". */
      root.append(banner("no providers configured"));
      return;
    }

    const doubtful = state === "stale" || state === "error";
    const body = el("div", `a-body${doubtful ? ` is-doubt fade-${fade}` : ""}`);
    for (const provider of payload.providers) body.append(providerRow(provider, now, read));

    if (state === "error") root.append(banner("proxy unreachable · showing the last reading, " + age(ageMs)));
    else if (state === "stale") root.append(banner(age(ageMs)));
    root.append(body);
  }

  const FADES = ["soft", "half", "ghost"];

  const STATES = [
    { id: "live", caption: "fresh, and certain" },
    { id: "stale", caption: "the payload has rotted", ageMs: 28 * HOUR },
    { id: "error", caption: "the proxy is gone", ageMs: 9 * MIN },
    { id: "empty", caption: "nothing configured" },
    { id: "loading", caption: "first read" },
  ];

  /** The clamped-pace crisis: every reset moved into the past. */
  function rot(payload, now) {
    return {
      ...payload,
      providers: payload.providers.map((provider) => ({
        ...provider,
        accounts: provider.accounts.map((account) => ({
          ...account,
          windows: account.windows.map((window) => ({
            ...window,
            resetsAt: window.resetsAt ? new Date(now - 60_000).toISOString() : null,
          })),
        })),
      })),
    };
  }

  window.QUOTA_ROUND48 = { shelf, STATES, FADES, STALE_AFTER, age, rot, readLaneStrict };
})();
