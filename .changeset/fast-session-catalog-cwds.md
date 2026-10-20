---
"forgerie": patch
---

Cut the remaining session-list delay. After the session list is built, the daemon reconciles unread, tab and activity state for each folder, and it found each folder's sessions by comparing every session's path with every folder. With 3,868 sessions in 133 folders that took about 0.3 seconds per load. Sessions are now grouped by folder once (about 3 ms).
