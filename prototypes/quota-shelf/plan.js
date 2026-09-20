/* The layout decision, written once, executed by every variant and every
   frame of the size ladder. Nothing below reads the device, the viewport, or
   a breakpoint tier: only the width and height the shelf is actually given.

   Every threshold is a named constant and a guess until it is measured in the
   real panel. */

(() => {
  const T = {
    // Below this the track is noise: the number carries the same fact in less
    // room, so the bar is the first thing to go (a bar is a readout).
    BAR_MIN_WIDTH: 250,
    // Below this an address truncates to its local part. The provider group
    // already says which service it is.
    EMAIL_FULL_WIDTH: 330,
    // Below this the reset instant stops being a column and folds under the
    // value, because two right-aligned columns start colliding.
    RESET_COLUMN_WIDTH: 296,
    // Above this there is room for a second account column: reflow spends the
    // plentiful axis instead of scrolling.
    COLUMN_WIDTH: 640,
    // A short container pays for rows by giving up padding, not by dropping
    // lanes.
    SHORT_HEIGHT: 300,
  };

  function plan(width, height) {
    const columns = width >= T.COLUMN_WIDTH ? Math.min(3, Math.floor(width / 320)) : 1;
    return {
      width,
      height,
      columns,
      bar: width >= T.BAR_MIN_WIDTH,
      email: width >= T.EMAIL_FULL_WIDTH ? "full" : "local",
      reset: width >= T.RESET_COLUMN_WIDTH ? "column" : "under",
      density: height <= T.SHORT_HEIGHT ? "compact" : "comfortable",
      // A wide, short container is not a small one: it keeps everything and
      // lays the groups out across the width it has.
      strip: width >= T.COLUMN_WIDTH && height <= T.SHORT_HEIGHT,
    };
  }

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  /** "12m", "4h", "1d 14h", "6d". Always the two largest useful units. */
  function duration(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
    if (ms < DAY) {
      const hours = Math.floor(ms / HOUR);
      const minutes = Math.round((ms % HOUR) / MIN);
      return minutes >= 5 && hours < 6 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    const days = Math.floor(ms / DAY);
    const hours = Math.round((ms % DAY) / HOUR);
    return hours === 0 || days >= 3 ? `${days}d` : `${days}d ${hours}h`;
  }

  function clockTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const isUnmetered = (lane) => lane.metered === false;

  /** Tone is about what the number means for work, not about the number. */
  function laneTone(lane, now) {
    if (isUnmetered(lane)) return lane.blocked ? "dead" : "open";
    if (lane.remainingPercent <= 0) return "dead";
    if (lane.remainingPercent < 10) return "danger";
    if (lane.remainingPercent < 30) return "warn";
    return "ok";
  }

  /** The metered lane that stops this account first. Unmetered lanes cannot
      bind, because they report no level to compare. */
  function bindingLane(account) {
    const metered = account.lanes.filter((lane) => !isUnmetered(lane));
    if (metered.length === 0) return null;
    return metered.reduce((low, lane) => (lane.remainingPercent < low.remainingPercent ? lane : low));
  }

  /** Remaining stated in the most concrete unit the provider gives us.
      Money when we have money, otherwise a share. */
  function laneValue(lane) {
    if (isUnmetered(lane)) return { text: "unmetered", exact: null };
    if (typeof lane.remainingAmount === "number") {
      return {
        text: `$${lane.remainingAmount.toFixed(2)}`,
        exact: lane.limitAmount ? `of $${lane.limitAmount.toFixed(0)}` : null,
      };
    }
    const value = lane.remainingPercent;
    return { text: `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`, exact: null };
  }

  /** Burn rate, and the wall-clock instant the lane runs dry at that rate.
      Only possible when the window length is known: a reset instant alone
      says when the tank refills, never how fast it is draining. */
  function runway(lane, now) {
    if (isUnmetered(lane)) return { known: false, reason: "not metered" };
    const untilReset = lane.resetsAtMs === null ? null : lane.resetsAtMs - now;
    if (lane.remainingPercent <= 0) return { known: true, dry: true, untilReset };
    if (!lane.windowMs) return { known: false, reason: "no window length", untilReset };
    const elapsed = lane.windowMs - (untilReset ?? 0);
    const used = 100 - lane.remainingPercent;
    if (elapsed <= 0 || used <= 0) return { known: true, dry: false, dryInMs: Infinity, untilReset };
    const dryInMs = elapsed * (lane.remainingPercent / used);
    return { known: true, dry: false, dryInMs, untilReset, lastsToReset: untilReset !== null && dryInMs >= untilReset };
  }

  window.QUOTA_PLAN = { T, plan, duration, clockTime, isUnmetered, laneTone, bindingLane, laneValue, runway };
})();
