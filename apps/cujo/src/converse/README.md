# converse — answering a person, in its own session

`@cujo-guard <anything>` on a pull request runs one turn and posts what the
agent said last. It is the only path where a comment provisions a sandbox.

**Its own TrueForge session, always** (decision 46). A second turn on the
review's session cancels a live review without telling its subscriber, is
refused `422` while an approval is pending — the exact state a maintainer wants
to talk in — and corrupts the projection, because `fold` dedupes checks by
thread id, so a re-run doubles every hard-rule critical and can never clear the
finding it was meant to correct.

**Never `Runner`.** `refold` writes run status unconditionally and emits on
`changes`, which drives the pull request reaction and the Discord card. A
conversation turn routed through it could move a `clean` run to `error` and
repaint a verdict nobody changed. The harness client is the only thing shared.

**The agent has no write tool.** Its spec carries `mcpServers: []`, and this
service posts the reply itself once the turn ends. That is what bounds prompt
injection through a stranger's comment to "wastes a sandbox", and it is why a
turn that errors or times out still answers the person — a reply tool cannot
apologise for its own absence.

**Repo write is required.** A sandbox is not free speech. The check is the same
one `/cujo confirm` uses and the refusal says what a reader can still do, since
every finding is public either way.

The message a person wrote is untrusted data, and `agent/CONVERSE.md` says so in
the rubric rather than only here: `SKILL.md` scoped that rule to the repository,
and this design publishes a second channel to the internet.
