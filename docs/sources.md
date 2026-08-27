# Sources and provenance

Where the reference docs came from, so a later reader can tell a fetched fact
from a design choice.

- [hackathon.md](hackathon.md) — pulled from the hackathon page and kickoff blog
  on 2026-08-23. Facts about dates, requirements, judging, and tracks are quoted
  from those pages; verify against the official rules before submission.
- [trueforge.md](trueforge.md) — distilled from the TrueForge repo and
  trueforge.dev docs on 2026-08-23. It restates public documentation; the live
  docs win if they diverge. The "Driving it headless" section and decision 17
  were verified by reading the TrueForge source (SDK 0.1.3) on 2026-08-27; the
  file paths cited there are in that repo at that date.

- Contract 7's Discord facts — the message endpoints, the `allowed_mentions`
  shape, the embed character limits, and the 429 body — were read from
  docs.discord.com on 2026-08-27. They restate public documentation; the live
  docs win if they diverge.
- Contract 8's — the interaction signing scheme and its required 401, the
  interaction and callback type numbers, the deferred-response endpoint, the
  three-second limit, and the 25-choice autocomplete cap — were read from the
  same source on 2026-08-28.

Everything else in `docs/` — architecture, spec, decisions, demo — is Cujo's own
design, not a quoted source.

## Primary sources

- Hackathon page — https://www.wemakedevs.org/hackathons/trueforge
- Kickoff blog — https://www.wemakedevs.org/blogs/agent-harness-hackathon-kick-off
- TrueForge repo — https://github.com/truefoundry/trueforge
- TrueForge docs index — https://trueforge.dev/llms.txt
- WeMakeDevs Discord (support) — https://discord.gg/wemakedevs
- Discord message resource — https://docs.discord.com/developers/resources/message
- Discord rate limits — https://docs.discord.com/developers/topics/rate-limits
- Discord interactions overview — https://docs.discord.com/developers/interactions/overview
- Discord interaction responses — https://docs.discord.com/developers/interactions/receiving-and-responding
