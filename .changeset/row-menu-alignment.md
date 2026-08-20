---
"forgerie": patch
---

Fix the inbox row command drawer overflowing the panel's left edge. The drawer's padding-escape was written for the padded board header and also applied to row drawers, which open in an unpadded row slot — so "Pin to top", "Archive", and "Copy workspace path" rendered flush against (and partly past) the panel edge. The escape is now scoped to the header; row drawers align inside the panel.
