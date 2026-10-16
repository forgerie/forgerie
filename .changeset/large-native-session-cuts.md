---
"forgerie": patch
---

Fix reconnect loops for sessions with large text-only turns. Send native session views in bounded chunks without dropping transcript content, and load saved images separately on both live and HTTP reads.
