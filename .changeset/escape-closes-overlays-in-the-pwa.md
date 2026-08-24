---
"forgerie": patch
---

Make Escape close overlays in the installed app. The app no longer calls the Fullscreen API on first interaction: Chrome reserves Escape for leaving that mode and never passes the key to the page, so the first Escape only left full screen and the image viewer stayed open. The installed app still runs full screen from its web manifest.
