/* Round 22: the live accounts, drawn exactly.
 *
 * Everything up to here ran on a fixture. This round loads the payload that
 * `fetch-live.sh` pulled from the router and converts it with the shipped
 * plugin's own rules, so the drawing is of the real thing rather than of a
 * plausible thing:
 *
 *   unmetered  id === "antigravity_gemini", the one pool that reports no level
 *   refusing   an unmetered pool whose account is unavailable or at zero
 *   window     lengthSeconds, absent on every Antigravity pool, so those lanes
 *              can carry no pace and no surplus
 *
 * `now` is the moment of the render, not the moment of the fetch, and both are
 * printed on the page so a countdown can be checked. */

(() => {
  const payload = window.QUOTA_LIVE;

  const UNMETERED = "antigravity_gemini";

  function toLane(quotaWindow, available) {
    const unmetered = quotaWindow.id === UNMETERED;
    return {
      id: quotaWindow.id,
      name: quotaWindow.name,
      windowMs: typeof quotaWindow.lengthSeconds === "number" ? quotaWindow.lengthSeconds * 1000 : null,
      remainingPercent: quotaWindow.remainingPercent,
      remainingAmount: typeof quotaWindow.remainingAmount === "number" ? quotaWindow.remainingAmount : null,
      limitAmount: typeof quotaWindow.limitAmount === "number" ? quotaWindow.limitAmount : null,
      resetsAtMs: quotaWindow.resetsAt ? Date.parse(quotaWindow.resetsAt) : null,
      metered: !unmetered,
      // The payload states no cooldown instant, so a refusing pool is one the
      // router has marked unavailable or that reports nothing left.
      blocked: unmetered && (!available || quotaWindow.remainingPercent <= 0),
      blockedUntilMs: quotaWindow.resetsAt ? Date.parse(quotaWindow.resetsAt) : null,
      lastBlockedMs: null,
      history: null,
    };
  }

  const ACCOUNTS = payload.providers.flatMap((provider) => provider.accounts.map((account) => ({
    provider: provider.name,
    providerId: provider.id,
    email: account.email,
    routed: account.selected === true,
    available: account.available !== false,
    state: account.selected ? "routed" : "standby",
    lanes: account.windows.map((quotaWindow) => toLane(quotaWindow, account.available !== false)),
  })));

  const groupOf = (id) => {
    const provider = payload.providers.find((candidate) => candidate.id === id);
    return { provider: provider.name, accounts: ACCOUNTS.filter((account) => account.providerId === id) };
  };

  /** Every number the Codex row is drawn from, so the drawing can be checked. */
  function codexFacts(now) {
    const group = groupOf("codex");
    const rows = group.accounts.map((account) => {
      const lane = account.lanes[0];
      const leftMs = lane.resetsAtMs - now;
      const pace = (leftMs / lane.windowMs) * 100;
      const fill = Math.max(0, Math.min(100, lane.remainingPercent));
      return {
        email: account.email,
        routed: account.routed,
        available: account.available,
        fill,
        leftMs,
        pace,
        surplus: Math.max(0, fill - pace),
        resetsAtMs: lane.resetsAtMs,
      };
    });
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      rows,
      pooledFill: mean(rows.map((r) => r.fill)),
      pooledPace: mean(rows.map((r) => r.pace)),
      atRisk: mean(rows.map((r) => r.surplus)),
      soonest: Math.min(...rows.map((r) => r.leftMs)),
    };
  }

  const stamp = (ms) => new Date(ms).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const days = (ms) => `${(ms / 86_400_000).toFixed(2)} d`;

  window.QUOTA_ROUND22 = { ACCOUNTS, groupOf, codexFacts, stamp, days, payload };
})();
