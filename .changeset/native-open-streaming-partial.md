---
"forgerie": patch
---

Open and reconnect to a session while its model is writing a tool call. The browser's first view of such a session failed with "could not be cloned", so the page kept retrying about once a minute until the run finished, and sessiond spent work on every retry. The in-flight message is now copied out of the storage transaction before it is sent.
