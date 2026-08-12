# Prompt-resource catalog benchmark

- Measured: 2026-08-11T19:50:52.888Z
- Fixture: active agent profile against this feature worktree
- Samples: 20 warm sequential loads per path
- Local target: median ≤ 500 ms; p95 ≤ 2,000 ms
- Federated proxy target: median ≤ 1,500 ms; p95 ≤ 5,000 ms

| Path | Median | p95 | Max | Result |
|---|---:|---:|---:|---|
| Local service | 31.46 ms | 51.48 ms | 51.76 ms | PASS |
| Federated proxy contract | 28.72 ms | 32.41 ms | 42.97 ms | PASS |

The proxy sample exercises the registered project/workspace route and sessiond request contract in-process. It does not measure WAN or Tailscale transport latency.
