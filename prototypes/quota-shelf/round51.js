/* Round 51: one line per provider.
 *
 * The nested shelf gives every account its own lane and every meter its own
 * line. That is 13 lines for four providers today, and it grows with the
 * roster. This round asks what a provider looks like on exactly one line,
 * as a denser alternate mode rather than a replacement.
 *
 * The collapse has to cross two dimensions at once, and they are not the
 * same problem:
 *
 *   Codex   3 accounts, 1 meter each   collapse accounts
 *   Claude  1 account, 3 meters        collapse meters
 *   AN      2 accounts, 3 meters each  collapse both
 *
 * Round 28 ruled out pooling, and the reason is worth restating because it
 * is the trap this round walks back into: a pooled bar's length is a mean,
 * and a mean of two opposite errors is no error at all. So every candidate
 * below is put through the case that killed it.
 *
 *   the cancellation case
 *     One account at 10 per cent with 90 per cent of its window still to
 *     run -- starving, will be dry long before it resets. One account at
 *     90 per cent with 10 per cent of its window left -- idle, will lose
 *     almost everything unspent. Pool them and fill lands on 50, pace lands
 *     on 50, and the lane draws exactly on pace while one account is about
 *     to run dry and the other is about to waste a fortune.
 *
 *   the queue case
 *     Two accounts both wasting, at different distances. A mean shows one
 *     loss of average size; the truth is two losses.
 *
 * Five ways to put a provider on one line. Only the first is a mean.
 *
 *   sum     pool it: total credit over total allowance, pace averaged. The
 *           control, included so the failure is visible rather than
 *           remembered.
 *   bind    the meter with the least left, wherever it lives. The thing
 *           that stops you first.
 *   pin     the routed account's binding meter. What you are actually
 *           spending right now; the rest are reserves.
 *   worst   the meter in the worst trouble, by risk rather than by level.
 *           A lane at 90 per cent with two hours left is in more trouble
 *           than one at 40 per cent with six days.
 *   split   no collapse at all: the track is divided into one segment per
 *           account, each keeping its own fill and its own cut.
 *
 * `bind` and `pin` answer "what can I spend now". `worst` answers "what is
 * about to go wrong". Those are different questions and no single line
 * answers both, which is the real finding of this round.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (v) => Math.max(0, Math.min(100, v));
  const DOOM_MIN = 8;
  const DOOM_CAP = 8;

  const doomColour = (rate) => {
    if (!Number.isFinite(rate) || rate <= 1) return "var(--warn)";
    const near = Math.min(1, Math.log(rate) / Math.log(DOOM_CAP));
    return `color-mix(in oklab, var(--warn), var(--danger) ${Math.round(near * 100)}%)`;
  };

  /**
   * How much trouble a lane is in, as one signed number.
   *
   * Positive is credit dying unspent, negative is a lane running dry. Both
   * are measured against the lane's own pace, so a five-hour lane and a
   * seven-day lane are comparable, which is the whole reason round 33
   * stopped measuring doom against a fixed horizon.
   */
  function risk(lane) {
    if (lane.pace === null) return 0;
    if (lane.fill > lane.pace) return lane.pace <= 0 ? Infinity : lane.fill / lane.pace;
    if (lane.fill < lane.pace) return -(lane.fill <= 0 ? Infinity : lane.pace / lane.fill);
    return 0;
  }

  const lanesOf = (provider) =>
    provider.accounts.flatMap((account) =>
      account.windows.filter((w) => !w.boolean).map((w) => ({ ...w, account })));

  /* ----------------------------------------------------------- the modes */

  const PICK = {
    /** A mean. The control. */
    sum(provider) {
      const lanes = lanesOf(provider);
      if (lanes.length === 0) return null;
      const fill = lanes.reduce((t, l) => t + l.fill, 0) / lanes.length;
      const paced = lanes.filter((l) => l.pace !== null);
      const pace = paced.length === 0 ? null : paced.reduce((t, l) => t + l.pace, 0) / paced.length;
      return { fill, pace, hue: 1, label: `${lanes.length} lanes pooled` };
    },
    /** Least left, wherever it lives. */
    bind(provider) {
      const lanes = lanesOf(provider);
      if (lanes.length === 0) return null;
      const pick = lanes.reduce((low, l) => (l.fill < low.fill ? l : low));
      return { ...pick, label: `${pick.account.email} · ${pick.name}` };
    },
    /** The routed account's binding meter. */
    pin(provider) {
      const routed = provider.accounts.find((a) => a.routed) ?? provider.accounts[0];
      const lanes = lanesOf({ accounts: [routed] });
      if (lanes.length === 0) return null;
      const pick = lanes.reduce((low, l) => (l.fill < low.fill ? l : low));
      return { ...pick, label: `${routed.email} · ${pick.name}` };
    },
    /** Worst trouble, by risk rather than by level. */
    worst(provider) {
      const lanes = lanesOf(provider);
      if (lanes.length === 0) return null;
      const pick = lanes.reduce((bad, l) => (Math.abs(risk(l)) > Math.abs(risk(bad)) ? l : bad));
      return { ...pick, label: `${pick.account.email} · ${pick.name}` };
    },
  };

  function bar(spec) {
    const lane = el("span", `b2-lane hue${spec.hue ?? 1}`);
    lane.style.setProperty("--fill", `${clamp(spec.fill)}%`);
    if (spec.pace === null || spec.pace === undefined) {
      lane.append(el("i", "b2-ground full"), el("i", "b2-fill flat"));
      return lane;
    }
    lane.style.setProperty("--pace", `${clamp(spec.pace)}%`);
    lane.append(el("i", "b2-ground left"), el("i", "b2-ground right"), el("i", "b2-fill left"));
    if (spec.fill > spec.pace) lane.append(el("i", "b2-fill right"));
    if (spec.fill < spec.pace && spec.fill > 0) lane.append(el("i", "b2-hatch"));
    if (spec.fill - spec.pace >= DOOM_MIN) {
      const doom = el("i", "b2-doom");
      doom.style.left = `${spec.pace}%`;
      doom.style.width = `${spec.fill - spec.pace}%`;
      doom.style.background = doomColour(spec.fill / spec.pace);
      lane.append(doom);
    }
    return lane;
  }

  /** No collapse: one segment of the track per account, each with its own cut. */
  function splitBar(provider) {
    const strip = el("span", "b2-split");
    for (const account of provider.accounts) {
      const lanes = account.windows.filter((w) => !w.boolean);
      if (lanes.length === 0) continue;
      const pick = lanes.reduce((low, l) => (l.fill < low.fill ? l : low));
      const cell = el("span", "b2-cell");
      cell.title = `${account.email} · ${pick.name}`;
      if (account.routed) cell.classList.add("routed");
      cell.append(bar(pick));
      strip.append(cell);
    }
    return strip;
  }

  /** How many accounts sit behind the one the line is drawn from. */
  function reserves(provider, shown) {
    const count = provider.accounts.length - (shown ? 1 : 0);
    const slot = el("span", "b2-res");
    if (count > 0) slot.textContent = `+${count}`;
    return slot;
  }

  function row(provider, mode) {
    const node = el("div", "b2-row");
    node.append(el("span", "b2-tag", provider.tag));

    if (mode === "split") {
      node.append(splitBar(provider), el("span", "b2-res"));
      return node;
    }
    const spec = PICK[mode](provider);
    if (spec === null) {
      node.append(el("span", "b2-none", "—"), el("span", "b2-res"));
      return node;
    }
    const lane = bar(spec);
    if (spec.label) lane.title = spec.label;
    node.append(lane, reserves(provider, mode !== "sum"));
    return node;
  }

  function shelf(root, providers, mode) {
    for (const provider of providers) root.append(row(provider, mode));
  }

  /* ------------------------------------------------------------ the data */

  const w = (name, fill, pace, hue = 1) => ({ name, fill, pace, hue });

  /** Today's real shape, simplified: the same providers, the same counts. */
  const LIVE = [
    {
      tag: "AN",
      accounts: [
        { email: "simon.jackson.ebay@gmail.com", windows: [w("Claude", 100, null, 0), w("GPT-OSS", 100, null)] },
        { email: "simon.jackson@gmail.com", routed: true, windows: [w("Claude", 100, null, 0), w("GPT-OSS", 100, null)] },
      ],
    },
    {
      tag: "CL",
      accounts: [
        { email: "sjackson@amazeinsights.com", routed: true, windows: [w("Five-hour", 99, 91, 0), w("Seven-day", 44, 55), w("Fable", 44, 55, 2)] },
      ],
    },
    {
      tag: "CO",
      accounts: [
        { email: "simon@amazeinsights.com", windows: [w("Seven-day", 0, 28)] },
        { email: "sjackson@amazeinsights.com", routed: true, windows: [w("Seven-day", 10, 52)] },
        { email: "simon.jackson@gmail.com", windows: [w("Seven-day", 100, 96)] },
      ],
    },
  ];

  /** Round 19's killer: one starving account beside one wasting account. */
  const CANCEL = [
    {
      tag: "XX",
      accounts: [
        { email: "starving@example.com", routed: true, windows: [w("Seven-day", 10, 90)] },
        { email: "wasting@example.com", windows: [w("Seven-day", 90, 10)] },
      ],
    },
  ];

  /** Two losses behind each other. A mean shows one of average size. */
  const QUEUE = [
    {
      tag: "XX",
      accounts: [
        { email: "first@example.com", routed: true, windows: [w("Seven-day", 80, 20)] },
        { email: "second@example.com", windows: [w("Seven-day", 70, 30)] },
      ],
    },
  ];

  const MODES = [
    { id: "sum", caption: "pooled — the control" },
    { id: "bind", caption: "least left, wherever it lives" },
    { id: "pin", caption: "the routed account's binding meter" },
    { id: "worst", caption: "worst trouble, by risk not level" },
    { id: "split", caption: "one segment per account, no collapse" },
  ];

  window.QUOTA_ROUND51 = { shelf, MODES, LIVE, CANCEL, QUEUE, risk };
})();
