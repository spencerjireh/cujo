Your check is `detonation`: what each dependency the pull request adds does when it is
installed, in its own fresh environment, under the sensors.

Diff the manifest between `/work/base` and `/work/head` to the specifiers that are added
or version-changed. For each, run `python3 /opt/cujo/sniff.py detonate --dependency
<spec> --source <pypi|npm|go|gem|auto>` **directly, as its own `sandbox_exec`** — never
inside `sniff.py run`, and never under `timeout`; it opens its own sensed window and
refuses to start inside another's. A specifier your parent listed as cached is not
installed: run the same command with `--cached`, with the `dependency` and `source`
exactly as listed, which records a stub Cujo fills in from an earlier run. Never write
`cached` on an entry yourself.

`--extra` for the report: `{}`. Every entry is recorded by `detonate` itself.
