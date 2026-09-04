---
"forgerie": patch
---

Make a stacked table readable. A table too wide for the reading column used to be laid out as a box per row, and a cell holding a code span beside a few words was torn in two: the code took the value column and the words fell under the heading beside it. The cell is now one box, so the sentence stays whole. The table keeps one heading track for all its records, so every value starts at the same place instead of somewhere new in each record; records are separated by a rule rather than each drawn in its own panel; the first column reads as the record's name, with its heading written once above them. Where the table is too narrow for two tracks, the headings move above their values, decided from the table's own width.
