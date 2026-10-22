---
"forgerie": minor
---

Dictation now runs through the new Speech to text plugin, which sends each recording to any service with the OpenAI audio API (a self-hosted gateway, speaches, LocalAI, OpenAI or Groq). Set its address in Settings > Plugins > Speech to text, and set `FORGERIE_SPEECH_API_KEY` on the web unit when the service needs a key. Forgerie no longer runs its own Whisper worker: `FORGERIE_WHISPER_STT_WORKER`, the `forgerie-whisper-stt-worker` flake package and the bundled `base.en` model are removed. Dictation stays unavailable until you set an address.
