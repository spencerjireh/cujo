"""Cujo in-sandbox sensors and detonation: the entry point the rubric runs.

The code is `cujo_sniff/`, the package sitting beside this file. Everything the
rubric documents -- `prepare`, `setup`, `run`, `detonate`, `teardown`, and the
report shapes in docs/spec.md Contract 2 -- lives there; this file exists so the
command stays `python3 /tmp/cujo/sniff.py ...`.

The import needs no install and no PYTHONPATH: `sys.path[0]` is the directory
holding the script, and the rubric extracts the archive so that this file and
`cujo_sniff/` land in it as siblings (decision 46).
"""

from cujo_sniff.cli import main

if __name__ == "__main__":
    main()
