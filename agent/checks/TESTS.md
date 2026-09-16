Your check is `tests`: the repository's own suite, on the branch it targets and on the
pull request, so a test that passes on base and fails on head is a regression the pull
request introduced.

Run the test command your parent gave you, wrapped, on `/work/base` first and then on
`/work/head`, with `--cwd` at the project root your parent named and `--workspace-root`
at the tree root. Read each run's output for the tests it names as failed.

`--extra` for the report: `base` and `head`, each a map of test id to `pass|fail` for
every test the output named, and `base_pass_head_fail`, the list of ids that passed on
base and failed on head. When neither output names a test, use `"suite"` as the one id
with the run's exit as its result.
