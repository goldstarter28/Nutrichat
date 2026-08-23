# Stage 5C — Conservative energy-balance reconstruction

Status: **PASS**

- SQLite integrity: **ok**
- Foods with exactly one P/C/F missing before this pass: **1,805**
- Accepted calculated values: **15**
- Rejected/left N/D because uncertainty was insufficiently controlled: **1,790**
- Fibre is mandatory for every reconstruction; missing fibre => no reconstruction.
- Alcohol and polyols are included when available; when unavailable a conservative uncertainty budget is added and risky food names/categories are excluded.
- Nominal factors: P 4, C 4, F 9, fibre 2, alcohol 7, polyols 2.4 kcal/g.
- Calculated values are marked `calculated_from_energy_balance`, reliability `medium`, `calculated_count=1`, never as measured.
- Existing safe numeric values are never overwritten.
- Previously discussed/manual example foods are excluded from this derivation pass as an additional anti-bias safeguard.

## Exact post-pass macro distribution among foods with energy

- 0 macros: 70
- 1 macro: 915
- 2 macros: 1,790
- 3 macros: 35,026
- Total: **37,801**

The deliberately low acceptance rate is expected: energy balance is not treated as an identity because food databases may use source-specific Atwater factors, rounding, and other energy-yielding components.
