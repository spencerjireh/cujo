# The sandbox image (decision 117).
#
# The image is ours now, which is the thing decision 46 did not have: the
# harness's sandbox provider manifest has no image field at all, so the image was
# somebody else's, there was no install step, and `sandbox/` had to be
# standard-library only and fetched at runtime from a tarball. All three of those
# go away here.
#
# What is installed is what a review needs to *run* a repository, which is the
# whole product: a Python toolchain, a Node toolchain, git, and the sensor code.
# Nothing else — this image is the untrusted zone, and every package in it is
# something a pull request's code can reach.
FROM python:3.13-slim-bookworm

# `tini` because the box is entered with `docker exec` and long-lived: without an
# init, a test suite that spawns and abandons a child leaves a zombie in PID 1's
# table for the life of the sandbox, and `subprocesses` in a report would then
# carry rows from a check that finished an hour ago.
#
# `git` is what `sniff.py prepare` clones with. `curl` and `ca-certificates` are
# what an install reaches a registry with, through the gateway. `build-essential`
# because a Python wheel that is not prebuilt for this platform compiles, and a
# review that fails to install is a review with no evidence.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    tini \
    git \
    curl \
    ca-certificates \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Node, for a repository whose manifest is a `package.json`. From nodesource
# rather than Debian's, which ships a version several majors behind.
ARG NODE_MAJOR=24
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/node.sh \
  && bash /tmp/node.sh \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -f /tmp/node.sh \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# `uv`, because it is what this repository's own Python projects install with and
# what a `.cujo.yml` is most likely to name. Pinned, like every dependency here.
ARG UV_VERSION=0.9.7
RUN curl -fsSL "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin sh

# `pytest` in the image, which is the other half of decision 111.
#
# The `tests` check had never once run against the demo repository: the install
# did not reach the service directories, and even when it did there was no
# `pytest` to run. 111 fixed the first half. This is the second, and it is a
# fallback rather than the path — a repository's own install is what should
# provide its test runner, and this is what stops a repository that has none from
# producing no evidence at all.
ARG PYTEST_VERSION=9.1.1
RUN pip install --no-cache-dir "pytest==${PYTEST_VERSION}"

# The sensor code, as a layer rather than a runtime fetch. `sniff.py` and
# `cujo_sniff/` land as siblings, which is what lets `sniff.py` import the package
# with no install — the same property decision 46 arranged with a tarball, now
# arranged with a `COPY`.
#
# `Context.from_env` derives `code_dir` from `__file__`, so nothing in the package
# needed changing to move it here. The state directory is separate and stays at
# `/tmp/cujo-state`, for the reason `context.py` gives: state that outlives the
# code it was written by has to sit outside the code.
COPY sniff.py /opt/cujo/sniff.py
COPY cujo_sniff /opt/cujo/cujo_sniff

# Where the trees go. `sniff.py prepare` writes `/work/head` and `/work/base`.
RUN mkdir -p /work

# A real user, so a review runs as one. Root in the box would make every
# `wrote_sensitive` reading weaker than it looks, because everything is writable
# to root and the decoy is supposed to be a file somebody chose to read.
RUN useradd --create-home --shell /bin/bash cujo \
  && chown -R cujo:cujo /work
USER cujo
WORKDIR /work

# Overridden by the runtime, which starts the box with `sleep infinity` and enters
# it with `exec`. Declared so the image is runnable on its own for a smoke check.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
