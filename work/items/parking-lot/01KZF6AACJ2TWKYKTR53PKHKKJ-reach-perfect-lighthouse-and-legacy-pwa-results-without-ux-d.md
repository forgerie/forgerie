---
id: 01KZF6AACJ2TWKYKTR53PKHKKJ
slug: reach-perfect-lighthouse-and-legacy-pwa-results-without-ux-d
title: Reach perfect Lighthouse and legacy PWA results without UX degradation
origin: parked
status: To Do
priority: medium
labels:
  - pwa
  - lighthouse
  - performance
  - ux
  - follow-up
created: 2026-08-07
source: user
---

# Reach perfect Lighthouse and legacy PWA results without UX degradation

## Why it matters

The deployed app currently scores 76 Performance, 100 Accessibility, 100 Best Practices, and 82 SEO in Lighthouse 13.0.3. Lighthouse no longer provides a PWA category, but Lighthouse 10.4.0 scores the app at 89% because no service worker controls the page and start URL. Improving these results must not introduce stale UI, cache session data, weaken reconnect behavior, or degrade the Fold 8 experience.

## Acceptance Criteria

- [ ] A repeatable production-mode audit command or script records Lighthouse 13 scores of 100 for Performance, Accessibility, Best Practices, and SEO across three consecutive mobile runs.
- [ ] The legacy Lighthouse 10 PWA audit reaches 100%, or each equivalent current Chrome installability and PWA criterion is verified and the deprecated score is documented.
- [ ] Any service worker has an explicit update strategy and never caches API responses, WebSocket traffic, credentials, transcripts, session payloads, or other user data.
- [ ] Cold load, refresh, reconnect, deployment update, installed-app launch, and recovery from an obsolete cached shell behave correctly without reload loops or stale assets.
- [ ] The installed and browser experiences pass visual and interaction checks on all four Fold 8 postures, including fold, unfold, rotation, and Android keyboard-open transitions.
- [ ] Automated tests cover manifest validity, service-worker scope and cache exclusions, update behavior, and the server fallback so missing worker and robots routes do not silently return application HTML.
- [ ] Performance work preserves current features and interaction behavior; bundle or loading changes use measured evidence and introduce no user-visible regression.

## Related

- `src/client/index.html`
- `src/client/public/manifest.webmanifest`
- `src/client/public/pwa-icon-192.png`
- `src/client/public/pwa-icon-512.png`
- `vite.config.ts`

## Notes

Baseline verified against https://forgerie.hummingbird-lake.ts.net/ on 2026-08-07. Lighthouse 13.0.3: Performance 76, Accessibility 100, Best Practices 100, SEO 82. Lighthouse 10.4.0 PWA: 89%; only automated failure was the missing controlling service worker. Current Lighthouse PWA testing is deprecated, so implementation must target current installability guidance as well as the legacy score.
