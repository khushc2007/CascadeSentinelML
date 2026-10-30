# Case-file provenance
| case | file | status in this build |
|---|---|---|
| IEEE-14 | `doomsday/gridtwin/data/case14.m` | **transcribed from memory, NOT verified against the official file** (`MANIFEST.json`: `transcribed_from_memory_UNVERIFIED`, no MATPOWER commit). Reproduces the published power-flow solution. |
| IEEE-30 | — | **absent** (official file not obtainable offline; not reconstructed from memory) |
| IEEE-118 | — | **absent** (same) |

Every grid loaded carries `grid.source["provenance"]` (status, commit) looked up by file name AND sha256; a modified or unknown
file is reported as `UNVERIFIED_*`.

## To install and verify the official data (needs network once)
```
git clone https://github.com/MATPOWER/matpower
git -C matpower checkout <tag-or-commit>          # record which one you use
PYTHONPATH=. python scripts/verify_case_files.py --matpower-dir matpower            # writes results/case_file_verification.json (no changes to data/)
PYTHONPATH=. python scripts/verify_case_files.py --matpower-dir matpower --install  # copies case14/30/118 UNMODIFIED, records commit + sha256 in MANIFEST.json
python -m pytest -q        # test_ieee30_* / test_ieee118_* stop skipping and run (they assert L = 41 / 186 from V2 2.3)
```
The report compares parsed bus/gen/branch/baseMVA tables with exact float equality (cell-level differences listed) and file sha256.
Project-specific modifications to upstream electrical data are NOT made anywhere; stress, ratings and base-point changes are
applied in code and recorded in the configuration, never written back to the case files.
