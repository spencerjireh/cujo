# The egress gateway (decisions 116, 121). One container per sandbox: the
# sandbox's router, holding the only route off its network and the nftables
# policy that filters it, and the sandbox's resolver, answering for the
# allowlist and nothing else. Deliberately tiny: it holds no pull request code
# and runs one shell script.
FROM alpine:3.22

# `nftables` writes the policy; `iproute2` finds which leg has the default route
# and claims the gateway address; `dnsmasq` is the resolver.
# No package manager left behind and no cache, so the image is what it says.
RUN apk add --no-cache nftables iproute2 dnsmasq \
  && rm -rf /var/cache/apk/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0500 /usr/local/bin/entrypoint.sh

# Root, and this is the one container here that needs it: writing a network
# policy needs NET_ADMIN, which is granted by the runtime rather than here.
# Nothing a pull request wrote ever runs in this image.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
