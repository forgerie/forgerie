# Decision hints

Decision hints is an optional gateway connection. It starts off. This foundation
provides settings and a client; attention hints and risk labels are separate
integration stages.

When enabled, turn replies and commands leave this machine through the gateway.
Enable it only for a gateway you trust. A hint can add information only. It must
not hide or demote a session, change a gate, or make a turn or command wait.
Failures return no opinion and retain today's behavior.

## Configuration

Open Settings > Plugins > Decision hints. Set the gateway base address and its
model name, then turn the plugin on. The default model is `fast`. Attention hints
and risk labels each have a switch. Sensitivity offers `low`, `normal` (default)
and `high`.

The same settings live in Forgerie's config (`~/.config/forgerie/config.json`, or
`PI_WEB_CONFIG`):

```json
{
  "plugins": {
    "decision-hints": {
      "enabled": true,
      "settings": {
        "gateway_url": "http://127.0.0.1:4000",
        "model": "fast",
        "attention": true,
        "risk_labels": true,
        "sensitivity": "normal"
      }
    }
  }
}
```

Use a base address without `/v1/systemone`. Forgerie posts to
`<baseUrl>/v1/systemone`. An empty address disables requests. Settings changes
apply to the next background ask without a sessiond restart. An unreadable config
means no hints. An ask already sent cannot be unsent by turning the plugin off;
consumers must check the live setting before publishing its result.

## Gateway key

Set `DECISION_GATEWAY_API_KEY` in the **sessiond service environment**. Restart
sessiond after changing the key; it captures its private environment at startup.
The gateway receives it as a Bearer token. A gateway without authentication can
leave this variable unset. This foundation uses the environment only, not a
profile key file.

Do not put a key in plugin settings, the gateway URL, or browser storage. Sessiond
removes this variable before agent bash processes can start. Managed processes
also filter it out. This is environment isolation, not a sandbox against an agent
reading host files.

The plugin form has no secret field. The existing status endpoint
`GET /api/pi-web/runtime` reports only
`components.sessiond.decisionHints.keyPresent`. This reports presence, not whether
the gateway accepts the key. The interface stage can display this status.

## Maintainer contract

Inject `DecisionHints` through `PiSessionServiceDependencies.decisionHints`.
`readSettings()` re-reads the config. Launch `client.ask(request)` in the
background; never await it in turn completion, gate admission, or tool execution.
The client returns the answering model and validated answers, or `undefined` for
no opinion. It refuses redirects and does not use a provider SDK.

The client timeout defaults to 2000 ms; composition can supply `timeoutMs`.
Use `assertDecisionHintOffEquivalence` from
`src/server/decisions/decisionHintsOffEquivalence.testSupport.ts` for consumer
tests. It compares immediate and settled observations for baseline, off,
unconfigured, unreachable and hanging gateway runs. It also rejects a scenario
that waits for the hanging gateway timeout. See its tests for an example.
