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
# name and allows the addresses, and tells the resolver to answer for each name.
#
# CUJO_GATEWAY_IP is the sandbox network's gateway address: reserved by Docker's
# IPAM, held by no interface because the bridge was created with `inhibit_ipv4`,
# and the address the sandbox's default route points at. This script claims it,
# which is what makes this container the sandbox's router (decision 121).
set -eu

log() { printf '{"service":"sandbox-gateway","event":"%s","detail":"%s"}\n' "$1" "$2"; }

if [ "$(cat /proc/sys/net/ipv4/ip_forward)" != "1" ]; then
  # `/proc/sys` is read-only in a container, so this cannot be fixed from here;
  # the runtime passes `--sysctl net.ipv4.ip_forward=1`. Refuse rather than run
  # as a gateway that forwards nothing and looks armed.
  log gateway.no_forwarding "ip_forward is off; refusing to start"
  exit 1
fi

if [ -z "${CUJO_GATEWAY_IP:-}" ]; then
  log gateway.no_address "CUJO_GATEWAY_IP is unset; refusing to start"
  exit 1
fi

# The leg facing the sandbox is the one whose subnet holds the gateway address;
# the other is the route out. Identified from the routing table rather than by
# name, so the deployment can call its egress network whatever it likes.
OUT_IF="$(ip route show default | awk '{print $5; exit}')"
if [ -z "${OUT_IF:-}" ]; then
  log gateway.no_route "no default route; refusing to forward"
  # Deliberately not a fallback. A gateway with no outside leg that still
  # forwards is a gateway that forwards to somewhere nobody chose.
  exit 1
fi
IN_ROUTE="$(ip -4 route get "$CUJO_GATEWAY_IP" 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1); exit}')"
if [ -z "${IN_ROUTE:-}" ] || [ "$IN_ROUTE" = "$OUT_IF" ] || [ "$IN_ROUTE" = "lo" ]; then
  log gateway.no_sandbox_leg "no interface faces the sandbox network; refusing to forward"
  exit 1
fi
IN_PREFIX="$(ip -4 -o addr show dev "$IN_ROUTE" | awk '{print $4; exit}' | cut -d/ -f2)"
# Claim the address the sandbox routes through. Nobody else holds it: Docker
# reserved it and, with the bridge inhibited, assigned it to no interface.
ip addr add "${CUJO_GATEWAY_IP}/${IN_PREFIX:-24}" dev "$IN_ROUTE"

nft add table inet cujo
nft add chain inet cujo forward '{ type filter hook forward priority 0; policy drop; }'
nft add chain inet cujo input '{ type filter hook input priority 0; policy drop; }'
nft add chain inet cujo postrouting '{ type nat hook postrouting priority 100; }'

# Established traffic first, so a reply to an allowed request is not re-judged.
nft add rule inet cujo forward ct state established,related accept
nft add rule inet cujo input ct state established,related accept
nft add rule inet cujo input iifname lo accept
# The one thing the sandbox may ask this container itself: a name. Everything
# else addressed to the gateway, rather than through it, is dropped.
nft add rule inet cujo input iifname "$IN_ROUTE" udp dport 53 accept
nft add rule inet cujo input iifname "$IN_ROUTE" tcp dport 53 accept

# No DNS rule in the forward chain: the sandbox resolves through this container,
# not through it. Its queries land on the input path at the address claimed
# above, and the resolver below answers for the allowlist and nothing else.

# The resolver's upstream is this container's own, which on a user-defined
# network is Docker's embedded resolver with the host's servers behind it.
UPSTREAM="$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf)"
if [ -z "${UPSTREAM:-}" ]; then
  log gateway.no_upstream "no nameserver to forward allowlisted names to"
  exit 1
fi

allowed=0
dns_args=""
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
  # The name, and any name under it, forwards to the upstream. Everything else
  # is caught by the `address=/#/` below and answered NXDOMAIN, so a name outside
  # the allowlist does not resolve at all, let alone connect.
  dns_args="$dns_args --server=/${host}/${UPSTREAM}"
  IFS=','
done
IFS="$OLDIFS"

nft add rule inet cujo postrouting oifname "$OUT_IF" masquerade

# The resolver, listening only on the address the sandbox routes through.
# `dnsmasq` binds its sockets before it forks to the background, so once this
# returns the sandbox can query it. No hosts file, no resolv.conf: the only
# upstream it knows is the one given per allowlisted name.
# shellcheck disable=SC2086
dnsmasq --no-resolv --no-hosts --bind-interfaces \
  --listen-address="$CUJO_GATEWAY_IP" \
  $dns_args --address=/#/

log gateway.armed "$allowed addresses allowed via $OUT_IF"

# Nothing else to do. Staying alive is the job: the rules live in this
# container's network namespace and die with it, which is what ties the policy's
# lifetime to the sandbox's.
while true; do sleep 3600; done
