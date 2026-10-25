# The gate

Cujo is becoming a review gate (decision 180): a pull request goes in, plugins
run against it, one policy decides, and a signed verdict comes out. These five
pages are the whole idea, one page each. Read them in order. The shapes they
name are typed in [`packages/gate-contract`](../../packages/gate-contract/src/index.ts)
and shown complete in [`contracts/verdict.example.json`](../contracts/verdict.example.json)
and [`contracts/plugin-output.example.json`](../contracts/plugin-output.example.json).

- [pipeline.md](pipeline.md) — the six stages a pull request passes through,
  and where today's code lands in them.
- [plugins.md](plugins.md) — the one contract every check speaks: a manifest,
  a JSON document in, a JSON document out.
- [verdict.md](verdict.md) — what the gate says, what it is bound to, how it
  is signed, and how today's findings map onto it.
- [trust.md](trust.md) — what crosses the boundary, what is read from base,
  and who can lift a block.
- [policy.md](policy.md) — the one rule that decides a block, and what a
  repository can change about it.

Nothing on these pages runs yet. [architecture.md](../architecture.md) and
[spec.md](../spec.md) describe what runs today and stay true until a gate pull
request replaces a path, each with its own decision.
