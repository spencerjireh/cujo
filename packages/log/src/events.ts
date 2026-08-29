/**
 * The closed vocabulary (decision 37).
 *
 * A log call takes a name from this list and a bag of fields; there is no
 * free-text argument anywhere in the API. A name is greppable and countable
 * without parsing, which is what an audit trail needs, and — unlike prose — it
 * cannot be reworded by the next pull request without the change being visible
 * here.
 *
 * Names are `plane.thing.happened`, past tense, lowercase. The plane prefix is
 * the same split the file tree uses (decision 32), so `webhook.*` is
 * signature-gated ingress, `approve.*` is a human decision made on the pull
 * request, and `public.*` is anonymous — which means a query can ask about a
 * trust plane without knowing which file emitted the line.
 *
 * A guard test scans the source and fails on a name emitted but not declared
 * *and* on a name declared that nothing emits, because a vocabulary with dead
 * entries is fiction.
 */

export const EVENT_NAMES = [
  // One line per request, on every plane, emitted after the handler returns so
  // it can carry the status and the duration. The health probes are excluded
  // at the call site: they run every few seconds forever and would drown the
  // signal this whole vocabulary exists to create.
  "http.request",
  // Process lifecycle. `service.stopping` is what distinguishes a deploy from
  // a crash in a log that otherwise just ends.
  "service.started",
  "service.stopping",
  "service.fatal",
  // The harness bootstrap loop, which retries forever and gates the webhook.
  "harness.bootstrap.ok",
  "harness.bootstrap.failed",
  "harness.ready",
  // Signature-gated ingress. Every one carries `delivery_id`.
  "webhook.accepted",
  "webhook.ignored",
  "webhook.deferred",
  "webhook.rejected",
  // The delivery was good and the run still could not be claimed. Its own name
  // because it is not a refusal: nothing about the request was wrong.
  "webhook.failed",
  "repo.visibility.changed",
  // A pull request comment addressed to Cujo. Same plane as the rest of this
  // group: a signature is the only gate in front of it, and `comment.command.*`
  // is the first thing on this plane that decides a review (decision 45).
  "comment.ignored",
  "comment.command.applied",
  "comment.command.refused",
  "comment.command.failed",
  "comment.reply.failed",
  "comment.reaction.failed",
  // A question asked with `@cujo-guard`, answered in its own session.
  "converse.started",
  "converse.answered",
  "converse.refused",
  "converse.failed",
  "converse.turn.failed",
  "converse.turn.timeout",
  "converse.stream.dropped",
  "converse.reply.failed",
  "converse.cancel.failed",
  "converse.redelivered",
  "converse.disabled",
  // A run's life, from the claim to a terminal status.
  "run.skipped",
  "run.superseded",
  "run.supersede.deferred",
  "run.approval.reraised",
  "run.prepare.failed",
  "run.turn.started",
  "run.turn.start.failed",
  "run.turn.timeout",
  "run.stream.dropped",
  "run.stream.resubscribe.failed",
  "run.stream.lost",
  "run.hydrate.failed",
  "run.rehydrated",
  "run.rehydrate.failed",
  "run.poll.failed",
  "run.poll.adopted",
  "run.subscriber.threw",
  "run.cancel.failed",
  "run.status.changed",
  // Answering an approval nobody is going to decide, so the session can take
  // another turn (decision 39). Cujo denying on its own behalf, never a human
  // decision — those are `approve.*` and must stay tellable apart.
  "run.approval.cleared",
  "run.approval.clear.failed",
  "run.approval.clear.skipped",
  "check.started",
  "check.finished",
  // The one place a human decides: `/cujo confirm` on the pull request.
  "approve.applied",
  "approve.rejected",
  // The anonymous plane. All three are `debug` except the rejection.
  "public.stream.opened",
  "public.stream.closed",
  "public.stream.rejected",
  // Discord (Contracts 7 and 8). Never fatal to a run.
  "discord.commands.registered",
  "discord.commands.failed",
  "discord.notify.failed",
  "discord.binding.dropped",
  "discord.channel.unreadable",
  "discord.command.failed",
  // The eye and its successors on the pull request itself (decision 36).
  // Its own name, not a `discord.*` one: it is a GitHub write, and filing it
  // under Discord both inflates Discord failure counts and hides which
  // outbound integration actually broke.
  "reaction.failed",
  // Background reconciliation and outbound reads.
  "visibility.swept",
  "visibility.sweep.failed",
  "github.page_cap",
  // github-mcp: the only outward write in the system.
  "review.posted",
  "review.failed",
  "review.anchor.moved",
  // Stale review dismissal (decision 52).
  "review.stale.skipped",
  "review.stale.dismissed",
  "review.stale.dismiss.failed",
  "mcp.request.failed",
  // apps/web's route handlers.
  "proxy.rejected",
  "proxy.upstream.failed",
  "proxy.stream.failed",
  "proxy.stream.degraded",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
