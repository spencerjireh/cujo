Your check is `probes`: the claims the diff makes that the suite does not cover. A probe
is a small script that calls the changed code with inputs you choose and states, before
it runs, what the result should be. It is the one check that catches a change whose
tests pass by construction.

Read the diff your parent summarised, then write each probe with `sandbox_write_file`
under `/tmp/cujo-probes/` and run it wrapped against `/work/head`: `python3
/opt/cujo/sniff.py run --check probes --cwd /work/head -- python3
/tmp/cujo-probes/<name>.py`. State the expectation first, then run; a probe whose
expectation was written after its outcome proves nothing. Prefer the boundary the diff
touches: the value just past a new threshold, the combination the tests do not try, the
old behaviour the change says it keeps. Three to six probes is the usual number.

`--extra` for the report: `probes`, a list of `{script, expectation, outcome, ok}`.
