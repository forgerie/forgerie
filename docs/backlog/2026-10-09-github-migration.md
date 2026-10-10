# GitHub backlog migration

The full Forgerie backlog now lives in [GitHub Issues](https://github.com/forgerie/forgerie/issues).
On 2026-10-09, 19 parking-lot items and two completed records moved to issues.
All local backlog files under `work/items/` are removed, including the active-directory placeholder.

Each issue preserves the original description, acceptance criteria, metadata, and backlog ID.
Priority uses `priority: high`, `priority: medium`, or `priority: low`. The `parking-lot` label preserves the source category.
Forgerie lists trusted authors by default. The migration does not enable outside-author issue text for agents.

GitHub issue creation dates are migration dates. Original dates remain in each issue body.
The GitHub provider does not calculate `blocked_by` relationships. None of the 19 parking-lot items declared them.

| Original ID | GitHub issue |
| --- | --- |
| `01KZJ0KKRFTEW7193MASVMY4Q4` | [#1](https://github.com/forgerie/forgerie/issues/1) |
| `01KZMMQN2F307A35CS1DE17KTW` | [#2](https://github.com/forgerie/forgerie/issues/2) |
| `01KZPQWB7PKSJQC8S017C6MNRV` | [#3](https://github.com/forgerie/forgerie/issues/3) |
| `01KZPZQ2C38SBSFDZ8K6AWG0BT` | [#4](https://github.com/forgerie/forgerie/issues/4) |
| `01KZQ0EMT0H9DXGM1RGABXSXXB` | [#5](https://github.com/forgerie/forgerie/issues/5) |
| `01KZST34VJQF4T8D421J9ZENMS` | [#6](https://github.com/forgerie/forgerie/issues/6) |
| `01M03E03JY0YHKEEZHJJFD8Y8X` | [#7](https://github.com/forgerie/forgerie/issues/7) |
| `01M0DZG8Q1Y0NWYEAM3177F662` | [#8](https://github.com/forgerie/forgerie/issues/8) |
| `01M0EWSYS3EAAD56AJKS4JTATH` | [#9](https://github.com/forgerie/forgerie/issues/9) |
| `01M0EX569FHNB9EWDYT3PHD80A` | [#10](https://github.com/forgerie/forgerie/issues/10) |
| `01M1DDRKB22CN67H1N10DE9XTY` | [#11](https://github.com/forgerie/forgerie/issues/11) |
| `01M1DDRZAM7YA2QNQE63ZRSZA5` | [#12](https://github.com/forgerie/forgerie/issues/12) |
| `01M1DDSCAK22S5TXDX6MKYQK0Y` | [#13](https://github.com/forgerie/forgerie/issues/13) |
| `01M1DMNXREKC9H1RDCXDQYGRDG` | [#14](https://github.com/forgerie/forgerie/issues/14) |
| `01M1DZ0000000000000000000B` | [#15](https://github.com/forgerie/forgerie/issues/15) |
| `01M1G357D22DV4R6TXX19CNH04` | [#16](https://github.com/forgerie/forgerie/issues/16) |
| `01M2JYFC90DDHPPPVXWN33884M` | [#17](https://github.com/forgerie/forgerie/issues/17) |
| `01M4CR9YW13CBNV54F2GDNPDNQ` | [#18](https://github.com/forgerie/forgerie/issues/18) |
| `01M4HB7FZGB7RR4NQDFTXNEA4N` | [#19](https://github.com/forgerie/forgerie/issues/19) |
| `01KZFNG5XM0Y6CN7B39KFZFCE5` | [#20](https://github.com/forgerie/forgerie/issues/20), completed |
| `01KZKXSTMDPYHZQ2FDZJQAP5Y7` | [#21](https://github.com/forgerie/forgerie/issues/21), completed |

## Completed records

Issues #20 and #21 are closed as completed. Their comments preserve all five
original Markdown documents, including both plans and the dictation requirements.
The 71,113-byte dictation plan spans two comments because it exceeds the issue-body limit.
Every document was reconstructed from GitHub and checked against its original SHA-256
before its local file was removed. The original dates and completion evidence remain
in the document text.
