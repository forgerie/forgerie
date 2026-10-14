# Effect 4 and RPC migration plan

Status: proposal. Written 2026-10-10 after a read-only survey of `main` at `457fd2b5`. Nothing in this document has been built. The user must approve the decisions in the "Decisions" section before execution starts.

## Goal

Forgerie uses one execution model (Effect 4) for the code it owns, and one shared communication contract (Effect RPC) between the browser, the web process, and the session daemon. When the migration is complete:

- Every server service is an Effect service with a Layer. `sessiond.ts` and `app.ts` are composition roots, not hand-wired constructor chains.
- Every browser-to-server call is an RPC procedure defined once in `src/shared` with Effect Schema. The browser has no `fetch("/api/...")` calls and no hand-written WebSocket client.
- Every streamed update (session events, global events, notification summaries, workspace activity) is an RPC stream procedure.
- `typebox`, `zod`, and the hand-written parsers in route files are gone. `src/shared/apiTypes.ts` is derived from schemas.
- `@fastify/websocket` is gone from both processes. Fastify remains only for static files, attachment upload bytes, and speech audio bytes, or is replaced by `effect/http` (see Decision 4).
- Tests build the same Layers with configured implementations. Route tests become RPC-client-against-in-memory-server tests.

## What the survey found

All numbers are from `main` at `457fd2b5`, non-test files unless stated.

| Area | Measure |
| --- | --- |
| Effect usage today | 0 files |
| Server code | about 32,700 lines; `src/server/sessions/` is 19,173 of them |
| `PiSessionService` | 5,624 lines, 125 public methods, one class |
| Exported server classes | 86 |
| HTTP routes | 161 across 25 route files |
| WebSocket endpoints | 3 in sessiond (`/events`, `/sessions/events`, `/sessions/:id/events`), bridged 1:1 by the web process |
| Processes | 2: `web` (port 8504, mostly a proxy) and `sessiond` (unix socket) |
| Validation | `typebox` in 45 server and shared files; `zod` in 42 files, mostly `ui/src/contracts.ts` and the UI api factories |
| Shared wire types | `src/shared/apiTypes.ts` and siblings, 4,885 lines of TypeScript interfaces, 42 event `type:` tags |
| Browser transport | 9 `create*Api(fetch)` factories, 18 files with `/api/` literals, 1 WebSocket client in `ui/src/sessionStore.ts` (677 lines; owns reconnect, join, `seq` watermark, buffering) |
| Browser schemas | 29 UI files import `ui/src/contracts.ts`; 16 import `@shared/*` |
| Tests | 337 server test files (36 use `fastify.inject`, 37 use `piSessionService.testSupport`), 135 UI test files, 10 UI gates |
| Timers | 37 `setTimeout`/`setInterval` sites in server code |
| Deployment | systemd user units run `dist/`, restart kills in-flight runs |

Three facts shape the plan more than the rest:

1. The web process is a proxy. 161 routes in sessiond are reached through `registerSessionProxyRoutes`, which forwards by path prefix and bridges three sockets. RPC collapses this into one socket and one contract, but the two-process split must survive because sessiond restarts kill agent runs and the web process must stay up through them.
2. `PiSessionService` is the whole product. Wrapping it as an Effect service is one afternoon. Decomposing it is weeks and is not required for the goal. The plan wraps it and does not decompose it (Decision 5).
3. The `seq` watermark protocol in `sessionStore.ts` and `SessionEventHub` is a product contract (join snapshot plus buffered live events, drop `seq <= currentSeq`). RPC streams replace the socket, not the protocol. A test must prove the watermark survives.

## Verified facts about Effect 4

Checked against the npm registry and the Effect-TS/skills issue tracker on 2026-10-10.

- `effect@4.0.2` is the latest stable. `4.0.0` shipped after `rc.118`.
- RPC, HTTP, sockets, and schema live inside the `effect` package in v4: `effect/rpc`, `effect/http`, `effect/socket`, `effect/schema`. There is no `@effect/rpc` for v4 (`@effect/rpc` latest is `0.76.2`, a v3 package). The `unstable/` path segment used by release candidates was removed in `4.0.0` and has no compatibility export (Effect-TS/skills#15, closed 2026-10-09).
- `@effect/platform-node@4.0.3` declares a peer of `effect@^4.0.3`, which does not exist yet. Pin `effect`, `@effect/platform-node`, and `@effect/platform-browser` to `4.0.2` until the registry catches up.
- The Effect package ships `node_modules/effect/AGENTS.md`. The `Effect-TS/skills` repo ships an `effect-ts` skill and an `effect-v3-to-v4` skill. Install both before phase 0.
- Effect-TS/effect#8610 (open): a stream chunk that fails to decode on `RpcClient` kills every other request on the socket and does not interrupt the server. The design must put one session's event stream on its own decode boundary, or tolerate this until fixed.

## Target architecture

```diagram
flowchart LR
  B[Browser<br/>RpcClient over WebSocket] -->|/rpc| W[web process<br/>RpcServer]
  W -->|local groups| WL[Projects, Config, Speech,<br/>UiSettings, PiPackages]
  W -->|forwarded groups| WC[RpcClient to sessiond]
  WC -->|unix socket| S[sessiond<br/>RpcServer]
  S --> SL[Sessions, Processes, Children,<br/>Workflows, Worktrees, Backlog,<br/>GitHub, Pulls, Groups, Resources,<br/>Activity, Services]
```

### Contracts (`src/shared/rpc/`)

One `RpcGroup` per domain, each in its own file. Procedures carry `payload`, `success`, and `error` schemas. Streams use `stream: true`. Errors are tagged Schema classes (`_tag`), which matches the standards document. Example shape:

```ts
export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", { id: Schema.String }) {}
export const SessionsRpcs = RpcGroup.make(
  Rpc.make("sessions.list", { payload: ListSessionsRequest, success: Schema.Array(SessionSummary) }),
  Rpc.make("sessions.events", { payload: SessionRef, success: SessionUiEvent, error: SessionNotFound, stream: true }),
)
```

Groups, by owner:

| Group | Served by | Replaces |
| --- | --- | --- |
| `projects`, `workspaces`, `explorer`, `config`, `piPackages`, `uiSettings`, `speech.status`, `piWeb.status` | web | `app.ts`, `configRoutes.ts`, `piPackageRoutes.ts`, `workspaceExplorerRoutes.ts`, `gitRoutes.ts`, `uiSettings/routes.ts` |
| `sessions`, `sessionEvents`, `processes`, `children`, `childRuns`, `workflows`, `worktrees`, `worktreeCleanup`, `workspaceServices`, `backlog`, `github`, `pulls`, `projectGroups`, `resources`, `prompts`, `activity`, `health` | sessiond, forwarded by web | the 17 sessiond route files and `sessionProxyRoutes.ts` |

Binary bodies stay on HTTP: `POST /api/speech/transcribe` (audio bytes) and `POST /api/sessions/:id/attachments` (upload bytes). RPC carries their metadata and results.

### Server runtime

- `sessiond.ts` becomes `Layer.mergeAll(...)` of domain layers plus `RpcServer.layer` over a unix-socket `Socket` server. The 180-line `createSessionDaemonRuntime` body moves into `*.layer.ts` files next to each service.
- Existing classes stay classes. Each gets a `ServiceMap.Service` tag and a `Layer.effect` that constructs it from its dependencies. `PiSessionService` is wrapped, not rewritten.
- `SessionEventHub` becomes a `PubSub` per session plus a global `PubSub`, with `seq` stamped at publish. The RPC stream handler for `sessions.events` subscribes, and the join procedure returns `currentSeq` so the browser keeps the watermark rule.
- Shutdown moves to `Scope` finalizers in the order the current `shutdown()` function uses. The `attempt()` wrapper that sets `exitCode = 1` on a failed finalizer stays as behavior.
- Timers move to `Effect.sleep`, `Schedule`, and `Effect.forkScoped` only when the owning module is touched. 37 sites are not a goal in themselves.
- Pi SDK, `pi-durable`, `chord`, and the owned child-agent and managed-process services stay behind the adapters that already exist. They are not rewritten to Effect.

### Web process

- `app.ts` becomes a Layer that provides the web RpcServer and a Fastify (or `effect/http`) instance for static files and the two binary routes.
- Forwarded groups are implemented as `RpcGroup.toLayer` handlers whose bodies call an `RpcClient` for sessiond. Request-response forwards are one line each. Stream forwards are `Stream` passthroughs. A sessiond disconnect surfaces as a typed `SessionDaemonUnavailable` error, which replaces today's `502` body.

### Browser

- One `RpcClient` over one WebSocket to `/rpc`, provided by a small `ManagedRuntime` created once in `main.tsx`.
- The 9 `create*Api(fetch)` factories become thin wrappers around the typed client with the same TypeScript shape, so their callers and tests change little. Then callers migrate to the client directly and the wrappers are deleted.
- `sessionStore.ts` keeps its state machine (`Connection`, `Join`, buffering, `Problem`). Its `SessionTransport` interface changes from `{request, connect}` to `{ client, events(ref): Stream }`. The reconnect loop becomes `Stream.retry` with the current `RecoveryTiming`. `watchRecovery` stays as is; it is browser event glue.
- React stays React. Rendering, hooks, and component state do not move into Effect. A `useStream(stream, initial)` adapter and the existing stores are the boundary.
- `ui/src/contracts.ts` (zod) is deleted. UI imports schemas and types from `@shared/rpc/*`.

### Tests

- Server: a `TestRuntime` layer provides in-memory stores and a `RpcClient` connected to an in-memory `RpcServer` through `RpcTest`. The 36 `inject` test files move to this. `piSessionService.testSupport.ts` keeps its shape; it gains a Layer export.
- Browser: `sessionStore` tests use an in-memory transport implementing the new `SessionTransport`. Component tests are unchanged where they already inject an api object.
- Coverage thresholds in `vitest.config.ts` are reset once at the end to the measured floor, as was done on 2026-10-08, with the reason recorded.

## Decisions the user must make before phase 0

Each decision has a recommendation. The recommendation is my judgement, labelled as such.

1. **Two processes stay.** Recommended: yes. The web process must survive sessiond restarts. Cost: every sessiond group is declared once and forwarded once, and stream forwarding needs an explicit test for backpressure and disconnect.
2. **One socket for everything, or one socket per session.** Recommended: one socket per browser tab, multiplexed by RPC, with `sessions.events` as a stream per subscribed session. Cost: Effect-TS/effect#8610 means a bad chunk on one stream can fail the socket until upstream fixes it. Mitigation: every event is validated at publish time on the server, so a decode failure on the client indicates a version skew, and the existing reconnect loop recovers.
3. **Dual-run or hard cutover per domain.** Recommended: dual-run per phase. REST routes stay until their RPC replacement is landed and deployed; then the REST route is deleted in the same phase or the next. `main` stays shippable at every landing. Cost: two paths exist for some weeks and knip must be told about the dying one.
4. **Fastify stays for static files and binary uploads, or `effect/http` replaces it.** Recommended: Fastify stays through the whole migration and is replaced in a final optional phase. Cost: two HTTP stacks in the web process until that phase. Benefit: the risky part (RPC, runtime) is not coupled to a static-file server swap.
5. **`PiSessionService` is wrapped, not decomposed.** Accepted by the user on 2026-10-10. Cost: the god object remains; Effect typed errors stop at its boundary (its methods throw `Error`, which the RPC layer maps to tagged errors by message pattern, as `mutationErrorStatus` does today). Decomposition into one-concern Effect services (lifecycle, prompting, asks, tree, catalog, durable children, processes, and so on) is filed as a follow-up GitHub issue in phase 0. Decomposition does not change Pi coupling: the Pi SDK adapters (`durableAgentSession.ts`, `piSessionManagerGateway.ts`, `modelRuntime.ts`, `durableSdkTools.ts`) are the same files either way.
6. **Schema source of truth moves to `src/shared/rpc/`.** Recommended: yes. `apiTypes.ts` becomes `export type X = typeof XSchema.Type` aliases during the migration and is deleted at the end. Cost: 4,885 lines of interfaces are reviewed by hand, because `typebox` and `zod` definitions do not convert mechanically.

## Phases

Each phase is one worktree under `.worktrees/effect/<phase>`, lands on `main` by rebase and fast-forward, runs `npm run verify`, and deploys per `AGENTS.local.md`. A phase that does not land is not done. Phase order is dependency order, and each phase is sized so one compaction window can finish it.

```steps
1. Phase 0: packet, pins, spike
   Create docs/migrations/effect-rpc/{charter,status,log}.md. Add effect@4.0.2, @effect/platform-node@4.0.2, @effect/platform-browser@4.0.2 to root and ui. Install Effect-TS/skills. Add eslint and knip rules for the new paths. Spike: one procedure (health) end to end: browser RpcClient to web RpcServer, forwarded to sessiond RpcServer over the unix socket, with one stream procedure that forwards the global event hub. Prove the forward works through a sessiond restart. Land, deploy. Record the ADR in docs/.
2. Phase 1: shared contracts
   Port src/shared/apiTypes.ts, the typebox schemas under src/shared, and ui/src/contracts.ts into Effect Schema under src/shared/rpc/, one file per domain. Keep the old types as aliases. Add a round-trip test per schema against recorded fixtures from the current server. No behavior change. Land.
3. Phase 2: sessiond runtime
   Turn createSessionDaemonRuntime into Layers. Each existing class gets a tag and a Layer.effect. Shutdown becomes Scope finalizers. SessionEventHub becomes PubSub with seq. Fastify routes still call the same instances, resolved from the runtime. Land, deploy.
4. Phase 3: RPC backbone
   Define every RpcGroup from the table above. Implement sessiond handlers for the small domains (projects, groups, backlog, github, pulls, worktrees, cleanup, services, activity, resources, prompts, health) by delegating to the existing services. Web serves its local groups and forwards the rest. REST stays. Land, deploy.
5. Phase 4: browser client for small domains
   Add the RpcClient runtime to the browser. Replace createProjectGroupApi, createBacklogApi, createGitHubApi, createWorktreeApi, createResourceApi, createPullRequestApi, createPluginsApi, createAppPluginStatesApi, and the uiSettings and config fetches with typed-client wrappers. Delete the matching REST routes and their inject tests after the browser no longer calls them. Land, deploy, validate on the device posture matrix for the touched screens.
6. Phase 5: processes, children, child runs, workflows
   Server handlers and browser stores for processes/processApi.ts, childAgents/childAgentsStore.ts, child run routes, workflow routes. These have live updates today through the global socket; they become streams. Delete the REST routes. Land, deploy.
7. Phase 6: sessions
   The largest phase. Server: sessions.* procedures for the 60-odd routes in sessionRoutes.ts, sessions.events stream with the seq watermark, join returning currentSeq. Browser: sessionStore.ts transport swap, Stream.retry with RecoveryTiming, buffered events and askBuffered and operationBuffered preserved. Contract test: snapshot plus buffered live events drop seq <= currentSeq. Delete the three WebSocket routes and the proxy. Land, deploy, validate on all four postures in both color schemes.
8. Phase 7: web process local groups and cleanup
   Projects, workspaces, explorer, config, piPackages, speech.status, piWeb.status move to RPC. Remove @fastify/websocket from both processes, sessionProxyRoutes.ts, SessionDaemonClient.request for JSON (keep only the binary passthrough). Remove typebox and zod. Delete apiTypes.ts aliases. knip clean. Reset coverage floor with a dated note. Land, deploy.
9. Phase 8 (optional): effect/http replaces Fastify
   Static files, attachment upload, speech transcribe. Only if the user wants one HTTP stack. Land, deploy.
```

Estimated size, measured by what each phase touches, not by time: phases 1, 3, and 6 each touch more than 100 files. Phases 0, 2, 4, 5, 7 touch 20 to 60 files each. The whole migration adds about 8,000 lines of schema and handler code and removes about 10,000 lines of routes, parsers, api factories, and interface declarations. These are estimates from the survey, not measurements.

## How the one-shot session survives compaction

The session will compact several times. Memory lives on disk, not in context.

- `docs/migrations/effect-rpc/charter.md` holds the goal, the decisions above as accepted, the phase list, and the finish line. It changes only with the user's agreement.
- `docs/migrations/effect-rpc/status.md` holds current phase, current worktree and branch, the last verified command and its result, the next action, and open blockers. It is rewritten at every checkpoint and is short.
- `docs/migrations/effect-rpc/log.md` is append-only: one entry per checkpoint with commit shas.
- A checkpoint is: tests pass for the slice, commit in the worktree, update status and log. Checkpoints happen at least every 30 to 40 tool calls, and always before a risky step.
- After every compaction, the first action is to read `status.md`, then `charter.md`, then `git status` and `git log -5` in the current worktree. Not the log file end to end.
- Each phase lands on `main` and deploys before the next phase starts. A compaction mid-phase loses at most the uncommitted work since the last checkpoint.
- The session stops and asks the user when: a decision in the charter must change; `npm run verify` fails for a reason outside the slice; a deploy leaves the units unhealthy; sessiond restart would kill an active run and the UI shows one.

## Risks and costs

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Effect 4 is 10 days past `4.0.0`; platform packages already have a peer-version mismatch | high | medium | Pin `4.0.2` exactly. Read `node_modules/effect/AGENTS.md` and the v3-to-v4 migration doc, not v3 knowledge. |
| Effect-TS/effect#8610: one bad stream chunk fails the whole socket | medium | high for sessions | Validate at publish. Keep the reconnect loop. Add a regression test that injects a bad chunk and asserts recovery. |
| `PiSessionService` throws untyped `Error`; RPC wants typed errors | certain | medium | Map at the handler boundary by the same rules `mutationErrorStatus` uses today. Decomposition is out of scope. |
| Schema port of 4,885 lines of interfaces introduces silent shape drift | high | high | Fixture round-trip tests per schema in phase 1, recorded from the running server before any change. |
| Dual-run leaves dead code that knip flags or that hides a missed call site | medium | low | Delete the REST route in the same phase its last browser caller moves. `rg "/api/"` in `ui/src` must return only the two binary routes at the end of phase 7. |
| sessiond restarts kill agent runs; each phase deploys | certain | medium | Deploy only when the UI shows no streaming session. Already a rule in `AGENTS.local.md`. |
| UI bundle grows | certain | low | Measure `vite build` output before phase 4 and after phase 7; record the delta. |
| The browser `ManagedRuntime` and React lifecycle conflict (hot reload, StrictMode double effects) | medium | medium | One runtime per page, created in `main.tsx`, never in a component. |
| Pi's own stack ships `@earendil-works/chord`, described as an application composition runtime with RPC. Forgerie imports its `Context` type in 5 durable files. | certain | low now | Keep chord behind the durable adapters. Note the overlap in the ADR so a later reader knows it was seen. |

## Chord and Effect

`@earendil-works/chord@1.1.0` is Pi's plugin and composition runtime: facets (per-environment plugin pieces with an esbuild bundler and `node:vm` loader), services (`defineService` tokens with a validated dependency graph), replicated state (delta-coalesced, reset-on-overflow), a transport-agnostic remote-service wire grammar with RPC "planned", and a Go-style cancellation `Context`. It has no transport, schema, typed errors, retry, or concurrency primitives. Effect has those and has no plugin loader or delta replication.

Forgerie imports chord in 5 files, all `src/server/sessions/durable*.ts`, for `type Context`, `type JsonValue`, and `BACKGROUND_CONTEXT`. Every `pi-durable` API takes a `Context`. `pi-durable` imports chord in 20 dist files and does not re-export `Context`, so the direct dependency cannot be removed.

Rules:

1. One bridge module, `src/server/sessions/chordContext.ts`, converts the current Effect fiber into a chord `Context` whose abort signal fires on interruption. Durable adapters call it. `BACKGROUND_CONTEXT` is not passed from Effect code, because that would leave Durable work running after the fiber is interrupted.
2. `eslint` `no-restricted-imports` forbids `@earendil-works/chord` outside `src/server/sessions/durable*.ts` and the bridge.
3. Chord types never enter a `ServiceMap` service or an Effect Schema. The Durable adapter converts commits into Forgerie domain events, as today.
4. Forgerie features do not use chord facets, services, or replicated state. Replicated needs use `SubscriptionRef` or a stream procedure.
5. Forgerie does not host chord presentation facets in the browser. Decided by the user on 2026-10-10. Plugins send data; Forgerie renders every plugin's UI itself, as it does for managed processes and child agents. No plugin-provided JavaScript runs in the page. Chord is never a browser dependency and never Forgerie's wire. The upstream review ritual may reopen this only if Pi ships a WebUI plugin standard that the user wants to support.
6. The upstream review ritual watches for chord's symmetric RPC as a server-side plugin concern only.

## Out of scope

- Decomposing `PiSessionService`.
- Rewriting `pi-durable`, the child-agent and managed-process services, or Pi SDK adapters in Effect.
- Moving React rendering or component state into Effect.
- Any UI redesign. Screens must look the same after every phase; posture captures are a regression check, not a design pass.
- Multi-machine or remote daemon support. The `/api/machines/local` prefix is removed, not generalised.

## Finish line

All of these are true on `main`, deployed, and verified by command:

1. `rg "from \"typebox\"|from \"zod\"" src ui/src` returns nothing.
2. `rg "fetch\(" ui/src --glob '!*.test.*'` returns only the attachment upload and speech transcribe calls, plus the two external quota endpoints in `plugins/accountMeters`.
3. `rg "websocket: true|@fastify/websocket" src` returns nothing.
4. `src/shared/apiTypes.ts` does not exist; all wire types derive from `src/shared/rpc/*`.
5. `npm run verify` passes. Coverage thresholds are at or above the recorded floor.
6. The four-posture, two-scheme capture set for the chat screen, the picker, the processes panel, and settings has been looked at and shows no regression.
7. `systemctl --user status forgerie-web.service forgerie-sessiond.service` shows both active on the new build, and a session can be opened, prompted, and reconnected after a sessiond restart.
