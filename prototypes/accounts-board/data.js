/* Fixture + shared helpers for the LLM accounts board iterations.
   Plain script (no ES modules) so every page also works over file://.

   The shape mirrors the real probe cache (~/.cache/pi/multi-account-usage.json
   written by the multi-account-usage extension): per-account snapshots with a
   used percentage per quota window, reset instants, and probe health. The
   board derives REMAINING headroom — monitoring is about what is left.

   "Now" is anchored to a fixed instant so captures are deterministic; live
   viewing ticks forward by real elapsed time from that anchor. */

(() => {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-08-19T14:03:00");

  const ACCOUNTS = [
    {
      key: "anthropic",
      product: "Claude",
      ordinal: 1,
      inUse: true, // driving the current session — selection semantics
      windows: [
        { id: "5h", label: "5 h window", usedPercent: 62, resetsAtMs: NOW + 1 * HOUR + 57 * MIN },
        { id: "7d", label: "7 d window", usedPercent: 46, resetsAtMs: NOW + 1 * DAY + 19 * HOUR },
      ],
      checkedAtMs: NOW - 45_000,
    },
    {
      key: "anthropic-3",
      product: "Claude",
      ordinal: 3,
      expired: true, // auth gone — no live numbers
      windows: [],
      checkedAtMs: NOW - 3 * DAY,
    },
    {
      key: "openai-codex",
      product: "Codex",
      ordinal: 1,
      windows: [
        { id: "5h", label: "5 h window", usedPercent: 13, resetsAtMs: NOW + 3 * HOUR + 37 * MIN },
        { id: "7d", label: "7 d window", usedPercent: 28, resetsAtMs: NOW + 4 * DAY + 18 * HOUR },
      ],
      checkedAtMs: NOW - 9 * MIN, // stale probe — worth a warning word
    },
    {
      key: "openai-codex-2",
      product: "Codex",
      ordinal: 2,
      error: "HTTP 429", // provider is refusing requests right now
      windows: [
        { id: "5h", label: "5 h window", usedPercent: 98, resetsAtMs: NOW + 22 * MIN },
        { id: "7d", label: "7 d window", usedPercent: 88, resetsAtMs: NOW + 2 * DAY + 16 * HOUR + 27 * MIN },
      ],
      checkedAtMs: NOW - 50_000,
    },
  ];

  const remainingPercent = (w) => Math.max(0, Math.round((100 - w.usedPercent) * 10) / 10);

  /* Least remaining across windows — the binding constraint. */
  const headroom = (account) => {
    if (account.expired || account.windows.length === 0) return null;
    return account.windows.reduce((least, w) =>
      least === null || remainingPercent(w) < remainingPercent(least) ? w : least, null);
  };

  const fmtDelta = (ms) => {
    if (ms <= 0) return "now";
    if (ms < MIN) return "under 1 m";
    const d = Math.floor(ms / DAY);
    const h = Math.floor((ms % DAY) / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
    if (h > 0) return m > 0 ? `${h} h ${m} m` : `${h} h`;
    return `${m} m`;
  };

  const fmtAgo = (ms) => (ms < MIN ? `${Math.max(1, Math.floor(ms / 1000))} s` : fmtDelta(ms));

  const fmtClock = (atMs, nowMs) => {
    const at = new Date(atMs);
    const now = new Date(nowMs);
    const hm = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (at.toDateString() === now.toDateString()) return hm;
    return `${at.toLocaleDateString("en-GB", { weekday: "short" })} ${hm}`;
  };

  const resetLine = (w, nowMs) =>
    `resets ${fmtClock(w.resetsAtMs, nowMs)} · in ${fmtDelta(w.resetsAtMs - nowMs)}`;

  /* Window tone: a status hue appears only when the status is true. */
  const windowTone = (w) => {
    if (w.usedPercent >= 95) return "danger";
    if (w.usedPercent >= 80) return "warning";
    return null;
  };

  /* Account-level state word (or null when nothing has a status). */
  const accountState = (account) => {
    if (account.expired) return { word: "signed out", tone: "danger" };
    if (account.error) return { word: "rate limited", tone: "danger" };
    return null;
  };

  const isStale = (account, nowMs) => nowMs - account.checkedAtMs > 5 * MIN;

  const checkedLine = (account, nowMs) => {
    const ago = fmtAgo(nowMs - account.checkedAtMs);
    return isStale(account, nowMs) ? `checked ${ago} ago · stale` : `checked ${ago} ago`;
  };

  /* Tick: render(nowMs) once immediately at the anchor (deterministic first
     paint for captures), then every second with real elapsed time added.
     The in-use account burns slowly so the live feel is honest. */
  const startBoardClock = (render) => {
    render(NOW);
    const started = performance.now();
    setInterval(() => {
      const elapsed = performance.now() - started;
      const active = ACCOUNTS.find((a) => a.inUse);
      const session = active?.windows.find((w) => w.id === "5h");
      if (session) session.usedPercent = Math.min(99.9, session.usedPercent + 0.005);
      render(NOW + elapsed);
    }, 1000);
  };

  window.BOARD = {
    NOW, MIN, HOUR, DAY, ACCOUNTS,
    remainingPercent, headroom, fmtDelta, fmtAgo, fmtClock,
    resetLine, windowTone, accountState, isStale, checkedLine, startBoardClock,
  };
})();
