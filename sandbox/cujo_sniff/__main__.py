"""`python3 -m cujo_sniff`, which is how the sensor daemons re-execute.

`-m` prepends the working directory to `sys.path`, so a daemon spawned with
`cwd` set to the directory holding this package imports it with no install and
no PYTHONPATH. See `daemons.spawn_daemon`.
"""

from __future__ import annotations

from cujo_sniff.cli import main

if __name__ == "__main__":
    main()
