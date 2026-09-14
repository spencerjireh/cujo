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
 * signature-gated ingress, `dismiss.*` is a human decision made on the pull
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
  // A handler that threw something other than a typed refusal (the harness
  // answers 500 and logs the cause here; a typed refusal is just a status).
  "http.failed",
  // Process lifecycle. `service.stopping` is what distinguishes a deploy from
  // a crash in a log that otherwise just ends.
  "service.started",
  "service.stopping",
  "service.fatal",
  // The harness bootstrap loop, which retries forever and gates the webhook.
  "harness.bootstrap.ok",
  "harness.bootstrap.failed",
  "harness.ready",
  // The harness itself (`apps/harness`, decision 123): a turn's life, the
  // gate holding a call, a sub-agent's thread, and pi's retries and
  // compactions surfaced as lines rather than events.
  "harness.turn.started",
  "harness.turn.finished",
  "harness.turn.failed",
  "harness.turn.suspended",
  "harness.turn.resumed",
  "harness.turn.recalled",
  "harness.turn.abandoned",
  "harness.gate.recalled",
  "harness.approval.superseded",
  "harness.thread.finished",
  "harness.retry.scheduled",
  "harness.compaction.finished",
  "harness.mcp.connect.retried",
  // Signature-gated ingress. Every one carries `delivery_id`.
  "webhook.accepted",
  "webhook.debounced",
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
  "run.claimed",
  "run.skipped",
  "run.superseded",
  "run.prepare.failed",
  "run.mode.resolved",
  "run.detonation.cached",
  "run.detonation.cache.written",
  "run.detonation.cache.failed",
  "run.turn.started",
  "run.turn.start.failed",
  "run.turn.timeout",
  "run.turn.retried",
  "run.stream.dropped",
  "run.stream.resubscribe.failed",
  // The stream is gone for good. Not a verdict: the turn is watched from here.
  "run.stream.lost",
  // That watch saw the turn actually end, and the fold has its real events.
  "run.stream.recovered",
  "run.hydrate.failed",
  "run.rehydrated",
  "run.rehydrate.expired",
  "run.rehydrate.failed",
  "run.event.invalid",
  "run.poll.failed",
  "run.subscriber.threw",
  "run.cancel.failed",
  "run.status.changed",
  "check.started",
  "check.finished",
  // A hard rule tripped on a check's report (decision 21). One line per rule
  // per check, so an operator can grep for under-gating incidents without
  // querying the run store.
  "check.hard_rule.tripped",
  // The run's first check started, which means sandbox setup completed and
  // sensors are armed. Logged once per run, on the first `check.started`.
  "run.setup.completed",
  // The one place a human decides: `/cujo dismiss` on the pull request lifts
  // a block (decision 138).
  "dismiss.applied",
  "dismiss.rejected",
  // `/cujo reset` from Discord (Contract 5, decision 123): a pull request's
  // sessions forgotten, or refused because a run is still on one.
  "session.reset",
  "session.reset.refused",
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
  // The `cujo/guard` check run on the head commit, the merge lock (decision
  // 138). A GitHub write like the reaction, and named apart from it for the
  // same reason.
  "check_run.written",
  "check_run.failed",
  // Background reconciliation and outbound reads.
  "visibility.swept",
  "visibility.sweep.failed",
  "github.page_cap",
  // github-mcp: the only outward write in the system.
  "review.posted",
  "review.duplicate.skipped",
  "review.failed",
  "review.anchor.moved",
  // Stale review dismissal (decision 52).
  "review.stale.skipped",
  "review.stale.dismissed",
  "review.stale.dismiss.failed",
  // Open Code Review beside a run (decision 149): what `apps/cujo` asked for
  // and heard back, and what the sidecar itself refused, finished or failed.
  // Nothing here reaches a pull request.
  "ocr.review.finished",
  "ocr.review.failed",
  "ocr.request.refused",
  "ocr.run.finished",
  "ocr.run.failed",
  // The one comment a run may post when the agent said nothing (109, 110).
  "review.announce.posted",
  "review.announce.skipped",
  "review.announce.failed",
  "mcp.request.failed",
  // sandbox-mcp: the sandbox behind an interface (113-116). `sandbox.created`
  // is this service's own line and not the harness event of the same name --
  // the harness stopped emitting one when it stopped provisioning.
  "sandbox.created",
  "sandbox.create.failed",
  "sandbox.exec.failed",
  "sandbox.exec.clipped",
  "sandbox.exec.clip_unsaved",
  "sandbox.write.failed",
  "sandbox.read.failed",
  "sandbox.destroy.failed",
  "sandbox.reap.failed",
  "sandbox.allowlist.refused",
  "sandbox.runtime.default",
  "sandbox.egress.unenforced",
  // The images the local runtime runs, built by sandbox-mcp at boot (118).
  "sandbox.image.build.started",
  "sandbox.image.build.finished",
  "sandbox.image.build.failed",
  // apps/web's route handlers.
  "proxy.rejected",
  "proxy.upstream.failed",
  "proxy.stream.failed",
  "proxy.stream.degraded",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
