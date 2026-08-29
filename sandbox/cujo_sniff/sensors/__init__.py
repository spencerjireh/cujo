"""The four sensors, each independent of the rest of the package's state.

No module in here imports `cujo_sniff.context`. A sensor takes the paths it
writes to as arguments, which is what lets the proxy and the decoy watcher run
as bare daemons — `python3 -m cujo_sniff _proxy --log ...` — with nothing to
build and nothing to read from the environment.
"""

from __future__ import annotations
