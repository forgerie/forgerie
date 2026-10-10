# Brief: Forgerie Home watch simulation

Date: 2026-10-10. For one agent working alone, in legs. Throwaway prototype.

## The question

What does it feel like to direct agents from the wrist? Build a full simulation of the interaction on the real watch. Simon uses it, then iterates on it with you. Nothing here connects to real Forgerie sessions. A later, separate plan builds the real thing from what the simulation teaches.

The simulation is good when Simon can wear the watch, play each scenario below by voice, touch, button and crown, and say what is wrong with it.

## Decisions already made

Do not reopen these without new evidence. Ask Simon if you have that evidence.

- The device is the round DM82 watch. Ignore the 720 × 720 watch for now. Its numbers must not appear in layout code.
- The shape is a native Android shell plus a WebView. The shell is the HOME app (launcher).
- The shell stays thin. It owns only what the web cannot do: HOME, the side button, the crown, the microphone, haptics, wake, and diagnostics. Everything Simon sees is the web page.
- The web page loads from a prototype server on zao. A web change then needs a reload, not a new APK.
- Simon talks to one front desk in plain speech. The front desk names the project and the session. In the scripted world, assume one global front desk across projects. This assumption is open. The simulation is one way to test it.
- Simon reads synthesis, not code. Agents hand back briefs: one heard sentence, what needs Simon, evidence labels (verified, inferred, opinion), and risk. Code and diffs are not on the watch.
- The crown is a deliberate "arm" control and not a scroll wheel. It is described below.
- Speech goes through one adapter in the prototype server. A separate effort will standardise speech-to-text and text-to-speech as a shared service. The adapter is the seam where that service replaces today's endpoint.
- Diagnostics are part of the first build. The watch reports its own measurements to zao, so the agent can analyse it without the cable.

## Device facts

Verified over ADB on 2026-10-10. Serial `76189549893703`.

| Part | Value |
|---|---|
| Model | DM82, board `sl8541e_1h10`, Spreadtrum SC9832E, 4 × Cortex-A53 at 1.4 GHz, Mali-T820 |
| OS | Android 8.1, API 27. Android 9 added the block on background microphone use, so this OS does not have it. |
| Memory, storage | 1.8 GB RAM, about 1.2 GB available. 7 GB free on `/data`. |
| Screen | 466 × 466 px, round, density 183. Expected WebView viewport: about 407 × 407 CSS px at DPR 1.14. This is inferred. Leg 1 measures it. |
| WebView | `com.google.android.webview` 138 |
| Network | 2.4 GHz Wi-Fi, LAN `192.168.1.231`. zao is `192.168.1.243` on the LAN. Tailscale is installed but not running. |
| Current HOME | `com.simonwjackson.assistantvoice/.VoiceActivity`, from `~/code/sandbox/assistant-foundation/android`. Its `VoiceLinkService` is a foreground service that holds the microphone and starts again after a reboot. |
| Disabled already | `com.hsc.launcher3`, `com.hsc.launchers`, `com.sprd.quickcamera`, `com.sprd.powersavemodelauncher` |
| Camera apps enabled | `com.android.camera2` |
| Side button | `sprd-gpio-keys` sends `KEY_F9` and `KEY_POWER`. `assistantvoice` receives the side button as `KEYCODE_HOME` (see its `VoiceActivity.kt`). |
| Crown | Simon: pull it out first. Pulling opens the camera at once. Then it twists up to 90 degrees each way. It must return to centre before it pushes back in. |
| Crown inputs | Unknown. Candidates: `rotary@0` (`REL_X`), `magnetic` (`KEY_F1`, `KEY_F2`, `KEY_F3`, `KEY_F8`), `sc7a22_input_key` (`KEY_F6`, `KEY_F10`). `Generic.kl` maps scan code 212 to `CAMERA`. |
| Cameras | Three back modes and one front, all 640 × 480 sensors |
| Wake | `wake_gesture_enabled` is 0. No lift-to-wake is known on this watch. |
| Speakers, mics | Built-in speaker, built-in and back microphone, Bluetooth A2DP |

## Speech that exists today

`forgerie-voice-content.service` runs on zao at `http://127.0.0.1:8790` (and `https://zao.hummingbird-lake.ts.net:8790` on the tailnet). `GET /api/status` reports `stt`, `tts` and `turn` as `ready`. It has `POST /api/stt`, `POST /api/tts` and `POST /api/check-turn`. Audio in is float32 little-endian, 16 kHz, mono. Read `prototypes/voice-content/server.py` and its README for the exact shapes and measured latencies. Do not change or restart that service. Call it only through the prototype server's speech adapter.

## Read first

| File | Why |
|---|---|
| `AGENTS.md`, `AGENTS.local.md` | Worktree rule, Nix rules, and how the production units run. |
| `~/.agents/skills/frontend-design/SKILL.md`, `~/.agents/skills/intrinsic-design/SKILL.md` | Required before any screen design. Layout follows the container: a 407 px circle with a safe square of about 288 px. |
| `prototypes/voice-content/README.md` | Narrator rules: merge, drop, expire, point instead of reading, never speak code. Reuse them for what the watch says. |
| `~/code/sandbox/assistant-foundation/flake.nix` | The `android` devShell to copy. |
| `~/code/sandbox/assistant-foundation/android/` | Gradle setup, manifest (`HOME` + `LAUNCHER` categories, `usesCleartextTraffic`), `VoiceActivity.kt` (button handling), `VoiceLinkService.kt` (foreground service, reboot survival), `Microphone.kt`, `Speaker.kt`, `WebProbeActivity.kt` (bare WebView settings). |
| `~/code/sandbox/assistant-foundation/scripts/install-voice.sh` | Install pattern that reports the versionCode it installed. |

## Rules

- Work in `.worktrees/watch-home-sim` on branch `proto/watch-home-sim` from `main`. Put everything under `prototypes/watch-home/`. Do not change `src/`, `ui/` or the root `flake.nix`.
- Do not restart or change `forgerie-web.service`, `forgerie-sessiond.service`, `forgerie-voice-content.service` or `pi-assistant-foundation.service`.
- Use Nix shebangs for scripts, as `AGENTS.md` requires. Use Node 24 for the server: `nix shell nixpkgs#nodejs_24`. The server has no npm dependencies.
- Every change to the device must be reversible. Record each one with its undo command in `prototypes/watch-home/README.md` before you make it. Do not run `assistant-foundation/scripts/watch-strip.sh`. Do not uninstall packages.
- Commit at the end of each leg. Land on `main` by rebase and fast-forward when Simon accepts the simulation, or earlier if he asks.

## Build and install

Copy the `android` devShell from assistant-foundation into `prototypes/watch-home/flake.nix`: `androidenv.composeAndroidPackages` with build tools 34.0.0, platform 34, `arm64-v8a`, plus `jdk17`, `gradle`, the `aapt2` override in `GRADLE_OPTS`, and `platform-tools` on `PATH`. Copy the Gradle wrapper (8.9), AGP 8.7.3 and Kotlin 2.1.20 from `assistant-foundation/android`. Use `minSdk 27`, `targetSdk 34`.

Verified on zao on 2026-10-10: `cd android && nix develop ..#android --command ./gradlew assembleDebug --rerun-tasks` rebuilds the assistant-foundation APK from scratch in 37 seconds. Gradle and SDK downloads are already cached on zao.

```sh
cd prototypes/watch-home/android
nix develop ..#android --command ./gradlew assembleDebug
nix develop ..#android --command adb install -r -d app/build/outputs/apk/debug/app-debug.apk
```

Write `prototypes/watch-home/scripts/install.sh`, modelled on `install-voice.sh`. It installs, grants `RECORD_AUDIO`, sets HOME, and prints the installed versionCode. Simon can also install the APK by hand when the cable is out.

HOME swap and its undo:

```sh
adb shell pm disable-user com.simonwjackson.assistantvoice      # frees the microphone and HOME
adb shell cmd package set-home-activity <your.package>/.HomeActivity
# undo
adb shell pm enable com.simonwjackson.assistantvoice
adb shell cmd package set-home-activity com.simonwjackson.assistantvoice/.VoiceActivity
```

## Architecture

```
watch (DM82)                                   zao
┌──────────────────────────────┐              ┌───────────────────────────────┐
│ HomeActivity                 │  HTTP + SSE  │ prototypes/watch-home server  │
│  WebView  ⇄  JS bridge       │ ───────────▶ │  /watch    the watch page     │
│ Shell service                │              │  /sim      desktop simulator  │
│  side button, crown, mic,    │              │  /control  Wizard-of-Oz panel │
│  haptics, wake, diagnostics  │              │  /world    scripted world     │
└──────────────────────────────┘              │  /speech   adapter ─▶ :8790   │
                                              │  /diag     JSONL ingest       │
                                              └───────────────────────────────┘
```

- **Cleartext.** The page loads over plain HTTP from `http://192.168.1.243:<port>`. Set `usesCleartextTraffic` as assistant-foundation does. A plain-HTTP page is not a secure context, so `getUserMedia` will fail. Capture the microphone natively, as `Microphone.kt` does, and upload it to the server.
- **Bridge.** The shell sends input to the page as events: button down and up, crown pulled, crown angle, crown pushed, wake, sleep, and microphone state. The page calls the shell to vibrate, start and stop capture, and play audio. Keep the bridge small and versioned.
- **Scripted world.** A world model on the server holds projects, sessions, child agents, `ask_user` questions, CI runs, and briefs. Scenarios are timelines of world events. The watch page and the simulator subscribe over SSE. No model calls.
- **Wizard of Oz.** `/control` runs on the Fold or a desktop. It shows what the watch heard, the matched intent, and the world state. It can fire any world event, pick the intent by hand when matching fails, and pause, step or restart a scenario.
- **Speech.** The native shell sends PCM16 to `/speech/stt`. The adapter converts it to float32 and forwards it to `:8790/api/stt`. Text to speech goes the same way, from `/speech/tts` to `:8790/api/tts`. Intent matching uses keywords, as in `voice-content`, with the Wizard as fallback.
- **Desktop simulator.** `/sim` shows the same watch page inside a 407 × 407 round frame. Keyboard: space holds the side button, `p` pulls and pushes the crown, the arrow keys twist it, `w` wakes. Use it, and a headless capture script, for fast design loops. The real watch is the judge.
- **Reload.** The server can tell the page to reload over SSE, so web changes reach the watch without an APK.

## The crown, as proposed

These are proposals. Leg 1 finds out what the hardware sends.

| Gesture | Meaning |
|---|---|
| Pull out | Arm. The current card enters choose mode. The camera must not open. |
| Twist | Choose by angle. Up to four options at fixed angles, with a haptic detent at each. The centre means nothing is chosen. |
| Side button while twisted | Commit the chosen option. Land and merge can be committed only this way. |
| Back to centre, push in | Cancel and leave choose mode. |

Taps stay the normal way to answer anything that Simon can undo.

## Diagnostics

The shell writes JSONL events and posts them in batches to `/diag`. The server appends them to `prototypes/watch-home/diag/<date>.jsonl`. Add `diag/` to `.gitignore`. The shell keeps a capped buffer when the server is not reachable. Diagnostics are on by default in this prototype.

Record at least these:

- Every `KeyEvent` and generic `MotionEvent` that reaches the activity: key code, scan code, device name, source, axis values, action, time.
- WebView: CSS viewport, `devicePixelRatio`, safe area, time from wake to first paint, long tasks, console errors.
- Power: battery level, temperature, screen on and off, drain per hour.
- Network: round trip to zao, SSE reconnects.
- Voice: button down to microphone open, upload size, speech-to-text time, time to first audio out.
- Crashes, sent at the next start.

Audio and transcripts stay out of `/diag`. The Wizard panel shows transcripts live and does not store them.

## Scenarios

The scripted world must play each of these. Each one names what Simon does and what the watch must give back.

1. **Glance.** Simon raises or wakes the watch. He sees the running work (one mark per running child agent), how many items need him, and the last brief in one line.
2. **Answer a question.** A session asks a question with three options. The watch vibrates. Simon taps one. The session continues and the watch says so.
3. **Steer.** Simon holds the side button and says "use the existing toast instead". The watch shows what it heard, the front desk confirms in one spoken sentence, and the session changes course.
4. **Hear a brief.** A unit of work finishes. The watch speaks one sentence ("Reviewer passed with one note. Tests pass. Ready to land.") and shows the facts: tests, review verdict, risk.
5. **Land with the crown.** Simon pulls the crown, twists to "Land", and presses the side button. A push without a commit cancels.
6. **Start work.** Simon says "In Forgerie, make the toast corner configurable." The front desk names the project, starts a session, and the first child agent appears.
7. **Dig deeper.** Simon says "send the reviewer back to check the folded layout". A reviewer run starts again with that question.
8. **Failure.** CI fails. The watch shows the verdict. Simon asks "what failed" and hears a short answer with no code read aloud.
9. **Offline.** zao is not reachable. The watch says so plainly, keeps the last state, and recovers by itself.

## Legs

Each leg ends on a completion check. Do not start a leg before the one before it passes.

### Leg 1: shell and probe

Build the shell (HOME, WebView, bridge, input logging, diagnostics) and a server that serves a probe page and accepts `/diag`. Install it. Swap HOME. Ask Simon to do this, slowly, with about 2 seconds between steps: pull the crown, twist fully left, return to centre, twist fully right, return to centre, push in, press the side button once, and press power once. Run `adb shell getevent -lt` while he does it.

Done when the README has a table that maps each physical gesture to the events the shell received. It must also record what opens the camera on pull and the undo for any change that stops it. It must also have measured values for viewport, DPR, wake to first paint, and battery drain over one hour with the screen off.

### Leg 2: world, simulator and Wizard

Build the world model, the nine scenarios, `/sim`, `/control`, the SSE stream, and a headless capture script that renders each scenario state at 407 × 407.

Done when every scenario plays from start to end in `/sim` and on `/control`, and you have read every capture.

### Leg 3: watch surfaces

Design and build the watch page for every scenario: glance, needs-you, decide, brief, crown choose mode, voice states (listening, heard, speaking), and offline. Read both design skills first. Use the full circle. Keep text inside the safe square.

Done when every scenario plays on the watch itself, and `adb exec-out screencap -p` captures of each state are in `prototypes/watch-home/shots/` and reviewed.

### Leg 4: voice

Connect native capture, the speech adapter, intent matching, spoken replies with the narrator rules, and barge-in: a side-button press stops speech at once.

Done when scenarios 3, 6, 7 and 8 work by voice on the watch, and the README has measured times for button release to text, and text to first audio.

### Leg 5: hand back

Write the README: how to start the server, install the shell, run each scenario, use the Wizard, and undo every device change. List the measured numbers and the open questions below, with what the simulation showed about each.

Done when Simon can run the simulation without you.

## Open questions the simulation feeds

- One global front desk, or one per project?
- How does this relate to assistant-foundation, which owns the watch today?
- Is voice plus four crown positions enough to decide things, or do some decisions need the phone?
- What must a brief contain for Simon to land work without reading code?
- Does the WebView stay fast enough on this chip, or does the glance need native drawing?

## Things only Simon can do

- Perform the crown and button gestures in leg 1.
- Start Tailscale on the watch before he uses it away from home. The simulation works on the LAN without it.
- Install the APK by hand when the cable is not connected.
