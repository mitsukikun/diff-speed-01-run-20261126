[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/mitsukikun/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/mitsukikun/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# diff-speed-01-run-20261126

A faster drop-in for make.fun's own `makefun-diff` 1.0.0. `solve.js` returns
exactly the same patch as makefun-diff 1.0.0 for every case, with less CPU
time.

## How it is faster

- The common prefix and suffix of lines are trimmed before any search, so
  the search only covers the lines that actually differ.
- Lines are compared as small integer ids, not as strings: each distinct
  line is mapped to an integer once per case, then the search runs over
  integer arrays. A final line with no newline gets its own id space, so it
  is never confused with the same text followed by a newline.
- Myers's greedy search keeps its V history in one flat typed array
  (Uint16 when the texts fit, Int32 otherwise) indexed by diagonal, reused
  across the search instead of allocating a path object per step. The edit
  script is recovered by backtracking through that history, recomputing
  each step's choice with makefun-diff's own tie-break (deletion wins when
  a deletion and an insertion reach the same point).
- The patch text is built in one array joined a single time at the end;
  there are no regular expressions in the hot path.
- `main.ts` turns V8's incremental marking off before importing the solver,
  the same flag tuning the house baseline uses.

## Layout

- `solve.js` — dependency-free ES module; `run(input)` returns
  makefun-diff's patch of `{ old, new }` as one string.
- `main.ts` — the program the harness runs: reads every case from the
  input cases file, answers each with `run`, and writes the answers file to
  the absolute output directory only.
- `LICENSE` — MIT.

## Verification

Checked against the kit's practice set (4/4 answers identical to the
reference) and against makefun-diff 1.0.0 on 3,061 hand-built edge cases
and randomized fuzz cases (empty texts, identical texts, no trailing
newline, carriage returns, single lines, everything deleted/inserted, and
change runs separated by 0–7 kept lines), all identical.
