# ingress — reachable from the internet

A signature is the only gate: HMAC on the GitHub webhook, Ed25519 on the
Discord interactions endpoint, both checked against the raw body before
anything is parsed. Neither GitHub nor Discord can solve a Cloudflare Access
challenge, so these routes sit on the webhook host (decision 7).

**Nothing here may approve a review** (decision 28). The commands this
dispatches to hold a `NotificationStore`, which cannot reach a run's decision —
keep it that way.
