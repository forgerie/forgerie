---
"forgerie": patch
---

Join managed process events into one queued follow-up while the agent is busy. Before, each exit or watched match queued its own follow-up, and each one cost a separate model turn. Now a later event joins the waiting follow-up, and a withdrawn follow-up comes back with all of its events.
