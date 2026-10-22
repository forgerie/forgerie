# Speech to text

The Speech to text plugin turns your voice into text in the composer. Forgerie
does not run a speech model. It sends each recording to a speech service that
speaks the OpenAI audio API.

The browser talks only to Forgerie. Forgerie's web process sends the recording
on to the service. Each recording leaves this machine for the address you set.

## Configuration

Open Settings > Plugins > Speech to text and set **Service address**. Voice input
stays off until an address is set.

| Setting | Default | Meaning |
| --- | --- | --- |
| Service address | empty | The API base address, usually ending in `/v1`. Forgerie posts to `<address>/audio/transcriptions`. |
| Model | `whisper-1` | The transcription model name that the service expects. A service with one model ignores it. |
| Language | `auto` | An ISO-639-1 code such as `en`. `auto` sends no language, so the service detects it. |

The same settings live in Forgerie's config (`~/.config/forgerie/config.json`, or
`PI_WEB_CONFIG`):

```json
{
  "plugins": {
    "speech-to-text": {
      "settings": {
        "base_url": "https://voice.example.ts.net/v1",
        "model": "whisper-1",
        "language": "en"
      }
    }
  }
}
```

Forgerie reads these settings for each status check and each recording.
A change needs no restart.

## Services that work

Forgerie uses the official `openai` npm client with your address. A service
that works with that client works here. Examples:

| Service | Service address | Key |
| --- | --- | --- |
| A self-hosted gateway, such as `voice-gateway` | `https://voice.<tailnet>.ts.net/v1` or `http://127.0.0.1:8792/v1` | None |
| speaches or LocalAI | The server's address plus `/v1` | None, unless you configured one |
| whisper.cpp `whisper-server` | Its address plus `/v1`. Start it with `--inference-path /v1/audio/transcriptions`. | None |
| OpenAI | `https://api.openai.com/v1` | Required |
| Groq | `https://api.groq.com/openai/v1`; model `whisper-large-v3-turbo` | Required |

Services with a different API do not work without an adapter. Examples are
Azure OpenAI (a different address layout and key header), Deepgram and
AssemblyAI.

## Service key

Set the key in the web process's environment as `FORGERIE_SPEECH_API_KEY`.
Forgerie sends it as a Bearer token. Without it, Forgerie sends no
`Authorization` header. The key is not a plugin setting, so the browser never
receives it. Restart the web unit after you change it.

Forgerie never sends the process's `OPENAI_API_KEY` or other `OPENAI_*`
values to the speech service. Sessiond hides `FORGERIE_SPEECH_API_KEY` from
agent commands and managed processes.

## What Forgerie sends

Each recording is 16 kHz mono audio. Forgerie sends it as a 16-bit PCM WAV.
A turn can last 10 minutes, which is 19.2 MB. That is under the 32 MiB upload
limit of common services. The request includes `model`, `response_format=json`
and, when set, `language`. Forgerie reads `text` from the reply and trims it.

## Status and failures

`GET /api/speech/status` checks the service each time. The OpenAI API has no
health route, so Forgerie calls `GET <address>/models` with a 3-second limit:

| Service answer | Status |
| --- | --- |
| 2xx, 404 or 405 | `ready`. 404 and 405 mean the service is up but lists no models. |
| Any other HTTP status, no answer, or a timeout | `unavailable` |
| No address, or the plugin is off | `unavailable`, without a request |

The browser checks status before each recording and shows "Speech service is
unavailable" when it is not ready. A recording that fails maps to the existing
speech errors: no answer is `speech_unavailable`, HTTP 429 is `overloaded`,
other HTTP errors are `speech_failed`, and the 120-second limit is `timeout`.
Cancelling a recording stops its HTTP request.

The status field that reports the service is still named `whisper`. Browsers
read that name.

## Silence

Whisper models can return words for silence. A test with 3 seconds of silence
returned "Thank you." Forgerie does not filter it, because a filter would also
remove those words when you say them. Ask the service to suppress non-speech
output if it can.
