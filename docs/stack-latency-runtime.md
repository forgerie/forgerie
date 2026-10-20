# Controlled stack latency measurements

Use Node 24 and managed processes. Never use a live profile, provider credential,
production service, or remote endpoint for these commands. The native launcher
creates a **new** owner-only `/tmp` directory and refuses an existing directory.
It serves the caller's built client through the production compressed web edge.

## Native fixture

```sh
node --import tsx scripts/stack-latency-native.mjs \
  /tmp/fg-native-UNIQUE 18642 /absolute/path/to/dist/client 20,300
```

Start this with the Forgerie process tool. Startup seeds real journals and can be
expensive. The launcher acquires heavy slot 2 and releases it at readiness or
startup failure. Do not wrap this command in another slot lock. Readiness is `NATIVE_FIXTURE_READY /tmp/.../fixture.json`.
Stop its managed process with TERM (`process stop`); the launcher closes the
web edge and its child daemon. The launcher refuses an occupied port before
seeding. Do not kill unknown port owners.

Verify a running fixture, optionally including a token-guarded daemon restart:

```sh
node scripts/stack-latency-native-check.mjs /tmp/fg-native-UNIQUE/fixture.json --restart
```

It prints `NATIVE_FIXTURE_CHECK_OK` after native HTTP opens, the first native
WebSocket `session.open` frame, marker identity, and a `/proc` check that
neither the edge nor the daemon holds a heavy-slot descriptor.

`fixture.json` is private (0600). It contains the loopback origin, deterministic
session IDs, fixture cwd, distinct destination markers and a fixture-control
token. It is an input, not a public evidence artifact. Histories accept 2–8
comma-separated turn counts (1–1500 each). Each turn has nine raw messages;
each session adds one distinct marker reply. The first two IDs are
`00000000-0000-4000-8000-000000000001` and
`00000000-0000-4000-8000-000000000002`.

The launcher calls the production command catalog to acquire active runtimes
without prompts. This is required because native admission is active-owner-only.
It then asserts that real HTTP `/open` responses are native. It does not relabel
classic responses. Journal creation uses the production parent-document
initializer. These are warm native owners, not daemon-cold or OS-cold probes.
The controlled provider is the SDK's `faux` implementation. No paid canary runs.

`POST /__fixtures/restart-daemon` requires the private `x-fixture-token`. It
restarts only the launcher's child daemon, reacquires the controlled owners, and
keeps the web edge alive. Forced-crash recovery is not covered. The metrics
endpoint reports fixture edge memory scalars and owned PIDs, not private records.
Keep fixture logs private; they can contain deterministic transcript data.

The launcher and its children survive coordinator/sessiond restarts when the
launcher itself runs as a Forgerie managed process. Session close still stops it.
A child handing it to its parent must use `keepAfterChild: true` and report the ID.

The canonical browser readiness runner remains
`ui/scripts/stack-latency-baseline.mjs`. Pass the fixture origin and the two IDs.
Do not pool different client builds, loads, fixture sizes or cache conditions.
