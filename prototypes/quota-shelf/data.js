/* Fixture for the quota shelf layout study.

   Taken from the live payload of https://cliproxyapi.hummingbird-lake.ts.net/quota
   on 2026-09-20T00:45Z, plus the two states the live snapshot did not contain
   (a proxy cooldown, a spent account). Plain script, no modules, so the pages
   also open over file://.

   The important property of this data: Antigravity's Gemini lane reports
   remainingFraction 1.0 for ever. It is not a level. Every variant has to
   decide what to draw in a cell that has no number. */

(() => {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-09-20T00:45:00Z");

  // A lane is one quota pool inside one account.
  //   metered:  a percentage that actually moves, with a reset instant.
  //   unmetered: the provider reports "full" whatever happens. The only real
  //              signal is the proxy's own 429/cooldown record.
  const lane = (o) => ({
    windowMs: null,
    remainingPercent: null,
    remainingAmount: null,
    limitAmount: null,
    resetsAtMs: null,
    metered: true,
    blocked: false,
    blockedUntilMs: null,
    lastBlockedMs: null,
    history: null,
    ...o,
  });

  // 24 h of two-minute samples, so a variant can draw a trend instead of a level.
  const decay = (from, to, count, jitter = 0) =>
    Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      const value = from + (to - from) * t;
      return Math.max(0, Math.min(100, value + (jitter === 0 ? 0 : Math.sin(i * 1.7) * jitter)));
    });

  const ACCOUNTS = [
    {
      provider: "Antigravity",
      providerId: "antigravity",
      email: "simon.jackson@gmail.com",
      routed: true,
      state: "routed",
      lanes: [
        lane({
          id: "antigravity_gemini",
          name: "Gemini",
          metered: false,
          resetsAtMs: Date.parse("2026-09-20T05:43:35Z"),
          lastBlockedMs: NOW - 6 * HOUR,
          blockEvents: [NOW - 21 * HOUR, NOW - 20.4 * HOUR, NOW - 9 * HOUR, NOW - 6.2 * HOUR, NOW - 6 * HOUR],
        }),
        lane({
          id: "antigravity_claude",
          name: "Claude",
          remainingPercent: 3.949573,
          resetsAtMs: Date.parse("2026-09-21T15:11:10Z"),
          history: decay(38, 3.9, 60, 1.5),
        }),
        lane({
          id: "antigravity_gpt_oss",
          name: "GPT-OSS",
          remainingPercent: 3.949573,
          resetsAtMs: Date.parse("2026-09-21T15:11:10Z"),
          history: decay(38, 3.9, 60, 1.5),
        }),
      ],
    },
    {
      provider: "Antigravity",
      providerId: "antigravity",
      email: "simon.jackson.ebay@gmail.com",
      routed: false,
      state: "cooling",
      coolingUntilMs: NOW + 12 * MIN,
      lanes: [
        lane({
          id: "antigravity_gemini",
          name: "Gemini",
          metered: false,
          blocked: true,
          blockedUntilMs: NOW + 12 * MIN,
          resetsAtMs: Date.parse("2026-09-27T00:43:35Z"),
          lastBlockedMs: NOW - 3 * MIN,
          blockEvents: [NOW - 55 * MIN, NOW - 34 * MIN, NOW - 12 * MIN, NOW - 6 * MIN, NOW - 3 * MIN],
        }),
        lane({
          id: "antigravity_claude",
          name: "Claude",
          remainingPercent: 0,
          resetsAtMs: Date.parse("2026-09-21T04:08:43Z"),
          history: decay(22, 0, 60),
        }),
        lane({
          id: "antigravity_gpt_oss",
          name: "GPT-OSS",
          remainingPercent: 0,
          resetsAtMs: Date.parse("2026-09-21T04:08:43Z"),
          history: decay(22, 0, 60),
        }),
      ],
    },
    {
      provider: "Claude",
      providerId: "claude",
      email: "sjackson@amazeinsights.com",
      routed: true,
      state: "routed",
      lanes: [
        lane({
          id: "five_hour",
          name: "5 h",
          windowMs: 5 * HOUR,
          remainingPercent: 85,
          resetsAtMs: Date.parse("2026-09-20T01:00:00Z"),
          history: decay(100, 85, 60, 0.8),
        }),
        lane({
          id: "seven_day",
          name: "7 d",
          windowMs: 7 * DAY,
          remainingPercent: 96,
          resetsAtMs: Date.parse("2026-09-26T14:00:00Z"),
          history: decay(99, 96, 60, 0.3),
        }),
      ],
    },
    {
      provider: "Codex",
      providerId: "codex",
      email: "sjackson@amazeinsights.com",
      routed: true,
      state: "routed",
      lanes: [
        lane({
          id: "seven_day",
          name: "7 d",
          windowMs: 7 * DAY,
          remainingPercent: 95,
          resetsAtMs: Date.parse("2026-09-26T08:48:19Z"),
          history: decay(99, 95, 60, 0.4),
        }),
      ],
    },
    {
      provider: "Codex",
      providerId: "codex",
      email: "simon@amazeinsights.com",
      routed: false,
      state: "spent",
      lanes: [
        lane({
          id: "seven_day",
          name: "7 d",
          windowMs: 7 * DAY,
          remainingPercent: 0,
          resetsAtMs: Date.parse("2026-09-24T19:59:14Z"),
          history: decay(11, 0, 60),
        }),
      ],
    },
    {
      provider: "Codex",
      providerId: "codex",
      email: "simon.jackson@gmail.com",
      routed: false,
      state: "spent",
      lanes: [
        lane({
          id: "seven_day",
          name: "7 d",
          windowMs: 7 * DAY,
          remainingPercent: 0,
          resetsAtMs: Date.parse("2026-09-22T18:01:19Z"),
          history: decay(14, 0, 60),
        }),
      ],
    },
    {
      provider: "OpenRouter",
      providerId: "openrouter",
      email: "sk-or-v1-545...431",
      routed: true,
      state: "routed",
      lanes: [
        lane({
          id: "openrouter_credits",
          name: "Credits",
          remainingPercent: 16.25869,
          remainingAmount: 1.625869,
          limitAmount: 10,
          resetsAtMs: null,
          history: decay(31, 16.3, 60, 0.6),
        }),
      ],
    },
  ];

  window.QUOTA_FIXTURE = { NOW, MIN, HOUR, DAY, ACCOUNTS };
})();
