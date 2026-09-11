#!/bin/sh
# The egress filter, outside the sandbox.
#
# This script runs in a container the sandbox can reach and cannot enter: no
# shared namespace, no shared filesystem, no shared process tree. It holds the
# only route off the sandbox's internal network, so what it drops is dropped
# (decision 116).
#
# Default deny, then the allowlist, then NAT for everything that survived. The
# order matters: the policy is set before a single packet can be forwarded, so
# there is no window in which the sandbox has an open route.
#
# CUJO_ALLOW_HOSTS is a comma-separated list of hostnames, already validated on
# the trusted side as hostnames with no port, scheme, CIDR, wildcard or control
# character. This script does not re-parse it into anything; it resolves each
# name and allows the addresses.
set -eu

log() { printf '{"service":"sandbox-gateway","event":"%s","detail":"%s"}\n' "$1" "$2"; }

if [ "$(cat /proc/sys/net/ipv4/ip_forward)" != "1" ]; then
  # Set on this container's own namespace, not the host's.
  echo 1 > /proc/sys/net/ipv4/ip_forward
fi

# The leg facing the sandbox is the internal network; the other is the route out.
# Identified by which one has a default route rather than by name, so the
# deployment can call its egress network whatever it likes.
OUT_IF="$(ip route show default | awk '{print $5; exit}')"
if [ -z "${OUT_IF:-}" ]; then
  log gateway.no_route "no default route; refusing to forward"
  # Deliberately not a fallback. A gateway with no outside leg that still
  # forwards is a gateway that forwards to somewhere nobody chose.
  exit 1
fi

nft add table inet cujo
nft add chain inet cujo forward '{ type filter hook forward priority 0; policy drop; }'
nft add chain inet cujo postrouting '{ type nat hook postrouting priority 100; }'

# Established traffic first, so a reply to an allowed request is not re-judged.
nft add rule inet cujo forward ct state established,related accept

# DNS to the Docker embedded resolver, which is what makes a hostname allowlist
# resolvable from inside the sandbox at all. UDP and TCP, port 53 only.
nft add rule inet cujo forward udp dport 53 accept
nft add rule inet cujo forward tcp dport 53 accept

allowed=0
# IFS rather than a pipe, so the loop runs in this shell and `allowed` survives.
OLDIFS="$IFS"
IFS=','
for host in ${CUJO_ALLOW_HOSTS:-}; do
  IFS="$OLDIFS"
  [ -n "$host" ] || continue
  # Every address the name resolves to, because a name behind a CDN is several
  # and allowing one of them is a flake rather than a policy.
  addrs="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if [ -z "$addrs" ]; then
    log gateway.unresolved "$host"
    continue
  fi
  for addr in $addrs; do
    nft add rule inet cujo forward ip daddr "$addr" accept
    allowed=$((allowed + 1))
  done
  IFS=','
done
IFS="$OLDIFS"

nft add rule inet cujo postrouting oifname "$OUT_IF" masquerade

log gateway.armed "$allowed addresses allowed via $OUT_IF"

# Nothing else to do. Staying alive is the job: the rules live in this
# container's network namespace and die with it, which is what ties the policy's
# lifetime to the sandbox's.
while true; do sleep 3600; done
