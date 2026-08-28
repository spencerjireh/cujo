# public — reachable by anyone, with no gate at all

The run board as an anonymous visitor sees it (decision 34). Cloudflare Access
does not sit in front of these routes and `PublicDeps` holds no verifier, so
there is nothing here to forget to check: what is safe is what this code chose
to emit.

Two invariants, and neither is optional.

**Nothing here may name a person.** `approver` and `decidedAt` are withheld, and
no route on this plane produces an email at all. The operator plane records who
approved because Access proves it; this plane has no such proof and must not
pretend otherwise.

**Nothing here may describe a repo that is not public.** Every read is filtered
on `is_public = 1` in SQL rather than by a caller remembering to check, a row
that was never answered counts as private, and a run nobody may see answers 404
rather than 403 — the plane does not confirm that a private repo has runs.

`serialize.ts` is an **allowlist**, not a redaction. Never build a response here
by spreading a run and deleting fields: that publishes every field added to
`Projection` from then on. Add the field name to `PUBLIC_SOURCE_FIELDS` or
`WITHHELD_SOURCE_FIELDS` and let the test tell you which one you forgot.

Do not import from `../operator/`.
