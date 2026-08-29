# ingress — reachable from the internet

A signature is the only gate: HMAC on the GitHub webhook, Ed25519 on the
Discord interactions endpoint, both checked against the raw body before
anything is parsed. Neither GitHub nor Discord can solve a Cloudflare Access
challenge, so these routes sit on the webhook host (decision 7).

**Nothing that arrives from Discord may approve a review** (decisions 28, 45).
The commands `discord-interactions.ts` dispatches to hold a
`NotificationStore`, which cannot reach a run's decision — keep it that way.
An interaction proves channel membership, which is not a claim about a
repository.

**A `/cujo` command on a pull request may** (decision 45). The rule was never
"this plane is untrusted": the HMAC is what makes a `repository` delivery as
trustworthy as a `pull_request` one, and the same signature covers an
`issue_comment`. What decision 28 rejected was a *principal* — Discord channel
membership — not a plane. The principal here is repo write, checked against
GitHub on every command, and the pull request's author may not dismiss a
finding against their own change (decision 44).

The rule that survives both: a decision is made in the trusted plane, on an
exact string, by code. Never by a model reading intent, which would let a
sentence anyone in the thread can write steer the gate.
