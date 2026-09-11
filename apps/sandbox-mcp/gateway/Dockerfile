# The egress gateway (decision 116). One container per sandbox, holding the only
# route off that sandbox's internal network and the nftables policy that filters
# it. Deliberately tiny: it holds no pull request code and runs one shell script.
FROM alpine:3.22

# `nftables` writes the policy; `iproute2` finds which leg has the default route.
# No package manager left behind and no cache, so the image is what it says.
RUN apk add --no-cache nftables iproute2 \
  && rm -rf /var/cache/apk/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0500 /usr/local/bin/entrypoint.sh

# Root, and this is the one container here that needs it: writing a network
# policy needs NET_ADMIN, which is granted by the runtime rather than here.
# Nothing a pull request wrote ever runs in this image.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
