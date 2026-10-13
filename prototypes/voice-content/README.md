# Voice plus content

**PROTOTYPE. Throwaway. Delete this directory once it has answered its question.**

The question: **can the voice use the chat stream as its source without reading
the chat stream aloud?**

Two endgames sit behind it. A headless mode where voice carries everything, and
a voice-plus-screen mode where the screen holds the dense material. In both, the
voice must never dictate the transcript.

## What is real and what is scripted

| Part | State |
|---|---|
| Text to speech | Real. CUDA Kokoro 82M, copied from `../../../comics`. |
| Speech to text | Real. `whisper.cpp` with `ggml-base.en`, copied from Forgerie. |
| Turn detection | Real. Smart Turn v3.2, copied from Forgerie. |
| Microphone capture | Real. AudioWorklet, 16 kHz mono, energy gate, barge-in. |
| The agent run | Scripted. Two fixture sessions in `web/sessions.js`. |
| The narrator | Rules, not a model. `web/narrator.js` decides what gets said. |

The agent is scripted on purpose. The question is about timing and division of
labour between ear and eye. A live model would add noise without adding
evidence.

## Run it

```sh
nix run path:.                       # http://127.0.0.1:8788
nix run path:. -- --port 8790        # somewhere else
```

The process warms all three models before it accepts requests. Warm-up measured
at 12.7 seconds.

While iterating on the interface, skip the rebuild:

```sh
nix develop path:. -c python server.py --port 8789 --web web
```

Open the page, press **start**, and talk. Chrome only allows a microphone on
`localhost` or over HTTPS. The server accepts loopback `Host` and `Origin`
values by default. Plain HTTP to a LAN address gives you the screen without the
microphone.

## On the phone

Live at **<https://zao.hummingbird-lake.ts.net:8790>**, tailnet only.

The unit keeps the process bound to loopback and passes
`--unsafe-allow-remote` because the HTTPS proxy forwards its tailnet host. Do
not combine that flag with `--host 0.0.0.0` on an untrusted network.

Two pieces of machine state make that work. Both are removable, and both should
go when this prototype does.

```sh
# the process, as a user unit that survives logout and reboot
systemctl --user status forgerie-voice-content.service
systemctl --user disable --now forgerie-voice-content.service
rm ~/.config/systemd/user/forgerie-voice-content.service
rm -rf ~/.local/state/forgerie-voice-content

# the TLS front door, held by tailscaled
sudo tailscale serve --https=8790 off
```

The unit builds the flake to `~/.local/state/forgerie-voice-content/result` and
runs that. The build result is a garbage-collection root, which matters: the
first version of the unit used `nix run`, which leaves no root, and the nightly
`nix-gc` on 2026-08-30 deleted the served source out from under the running
process. The process stayed up and answered 404 to everything. Restart the unit
to pick up source changes.

The unit passes `--unsafe-allow-remote`, because the tailnet front door sends
`Host: zao.hummingbird-lake.ts.net:8790` and the server otherwise accepts only
loopback Host and Origin values. The listener itself stays on loopback, so
`tailscale serve` remains the only way in. There is still no authentication:
anyone on the tailnet can reach `/api/tts` and `/api/stt` at that URL.

It holds about 2.8 GB of RSS and roughly 850 MB of VRAM for the Kokoro context.
This host has 6 GB of VRAM and `comics.service` already holds 2.5 GB of it, so
stop one of them before a third CUDA job.

Headphones help. The barge-in gate raises its threshold while the voice speaks,
but a loud speaker next to the microphone still causes false interruptions.

## The three variants

Switch with the bottom bar, the arrow keys, or `?variant=`.

| Variant | The screen is | The bet |
|---|---|---|
| `follow` | The whole transcript | The voice is a guide over the same content. It marks the block it is talking about. |
| `deck` | One card at a time | The screen carries only what speech cannot: diffs, tables, choices. No log. |
| `ambient` | Dark | Headless first. Content appears only when the voice hands it over or you ask. |

Other controls: `h` blacks out the screen (phone in pocket), `m` mutes the
voice, `p` opens the probe, space is push to talk, and the text box takes typed
input when you would rather not speak.

## The mechanic worth arguing about

Speech runs at about 2.5 words per second. A working agent emits content much
faster. The voice therefore cannot narrate everything, and any design that tries
turns into dictation. `web/narrator.js` holds the rules:

- **Merge.** Three file reads inside two seconds become "Reading three files."
- **Drop.** The queue holds two acts. A new act pushes out the lowest priority
  one. Progress lines lose to decisions.
- **Expire.** An act older than seven seconds is dropped rather than spoken
  late, unless it is a decision or an answer.
- **Point, do not read.** Acts carry a reference to the block they are about.
  The screen highlights it, the voice says "it is on screen".
- **Refuse to speak code.** Paths, filenames, camelCase identifiers, and long
  numbers are flagged as unspeakable.
- **Measure the overlap.** Every spoken line is scored against the block it
  refers to. Above 40 percent shared content words, the probe marks it. 100
  percent means the voice is reading the screen.

Press `p` to watch all of it: what was offered, merged, dropped, spoken, and how
close each line came to dictation.

Two more things use the stream rather than a script:

- Ask "what are you doing" and the reply is composed from the blocks that have
  arrived, not from a canned line. It counts tool calls and names the kind of
  the last block. Measured output: "Right now I am working. So far I have read
  three files. The last thing on screen is a note."
- When a wait runs longer than eight seconds with nothing to say, the engine
  builds a progress line from the current activity.

## Things to say

The intent matcher is keyword based. It knows:

| Say | Result |
|---|---|
| "what are you doing", "where are we" | Recap built from the stream |
| "hold the subscription", "the second one", "do it" | Answers the pending choice |
| "wait", "hold on" | Stops the run and the voice |
| "go on", "keep going" | Resumes |
| "show me" | Reveals the latest block, which matters most in `ambient` |
| "be quiet" | Mutes the voice, keeps the screen |
| "say that again" | Repeats the last line |

## What the research says

Three findings shaped the rules above.

- **Voice first, not voice only.** Amazon's Alexa design guide states the
  principle directly and gives the case for shortening speech when a screen is
  present: "when your customer has a screen, there may be instances where you
  can shorten the VUI response because the customer can see the additional
  detail on screen."
  <https://developer.amazon.com/en-US/alexa/alexa-haus/design-principles/be-multimodal>
- **Duplication hurts.** Mayer's redundancy principle: narration plus identical
  on-screen text lowers retention and transfer compared with narration alone.
  Partial redundancy, where the screen carries keywords rather than the whole
  script, does better than full redundancy. This is the strongest published
  argument against dictating the chat.
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6084336/> and
  <https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/YueBjorkBjork2013_redundancy.pdf>
- **Turn-taking is the felt quality.** Current voice-agent practice puts
  barge-in stop latency under 200 ms and treats fixed pause thresholds as too
  crude, which is why a semantic turn model is worth the extra process. Forgerie
  already ships one, so this prototype uses it.

## Measured on this host

| Path | Time |
|---|---|
| Kokoro line, warm cache miss, browser round trip | 91 to 106 ms |
| Kokoro line, first request of a run | 581 ms |
| Whisper on 3.7 seconds of speech | 0.88 to 1.2 s |
| Smart Turn decision on an 8 second window | 90 ms |
| All three models warm | 12.7 s |

## Checks

```sh
python -m unittest server_test.py
node --test web/voice.test.mjs
nix run path:.#smoke        # Kokoro speaks, ffmpeg converts, Whisper reads it back

# with the server running:
BASE=http://127.0.0.1:8789 CHROME_BIN=$(command -v chromium) node capture.mjs
BASE=http://127.0.0.1:8789 CHROME_BIN=$(command -v chromium) node loop-check.mjs "what are you doing"
```

`capture.mjs` drives each variant through a run, fails on any browser console
error, and writes `shots/`. `loop-check.mjs` closes the loop with no human in
the room: Kokoro speaks a command into a WAV, Chromium plays that file as the
microphone, and the page has to hear it. Measured pass:

```
said: hold the subscription
heard: Hold the subscription.  -> intent answer
replied: Holding it. That is the smaller change.
```

## Known holes

- Barge-in is untested by machine. Headless Chromium has no audio output, so
  the voice never plays and cannot be interrupted. Test it by hand.
- With audio blocked, every act drains instantly, so nothing merges or drops.
  The queue rules only engage when speech actually takes time.
- The individual "Reading the client socket" lines break the overlap rule at 67
  percent. They are only safe because the merge collapses them first. Either
  rewrite them or merge on every path.
- The intent matcher is keyword based. It has no idea what you mean if you
  phrase something a new way, and it answers with a generic acknowledgement.

## Open questions for the verdict

- Does `follow` earn the transcript, or does the eye stop reading once the voice
  is trustworthy?
- In `deck`, is losing the scrollback a relief or a loss?
- In `ambient`, is "four steps you did not need to see" reassuring or
  unnerving?
- What should happen at the transition? Black the screen mid-run with `h`, then
  bring it back. Each variant currently does nothing special. Something should.
- Is the two-act queue right? Try one, try four.
- Should a decision always wake the screen, in every variant?

**Verdict: not yet recorded.**

## Files

| Path | Holds |
|---|---|
| `server.py` | HTTP process: static files, TTS, STT, turn detection |
| `voice_runtime.py` | Worker processes, protocols, PCM conversion |
| `workers/` | Copies of the Kokoro, Whisper, and Smart Turn workers |
| `nix/` | Copies of the three worker packages |
| `web/narrator.js` | The rules under test |
| `web/engine.js` | The run, the queue drain, and what you can say |
| `web/sessions.js` | The two scripted agent runs |
| `web/variants/` | The three treatments |
| `web/probe.js` | The instrument, not part of the design |
| `server_test.py`, `web/voice.test.mjs` | Request-policy and interruption regressions |
