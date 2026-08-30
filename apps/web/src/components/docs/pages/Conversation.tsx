import { C, LI, Lead, Note, P, Pre, Section, UL } from "@/components/docs/Prose";
import Link from "next/link";

export function Conversation() {
  return (
    <>
      <Section id="what" title="Ask it to prove something">
        <Lead>
          Mention <C>@cujo-guard</C> in a comment on the pull request, or in a reply inside one of
          its review threads, and it answers there.
        </Lead>
        <Pre>
          {
            "@cujo-guard that endpoint needs orders to exist.\nSeed the database first and try it again."
          }
        </Pre>
        <P>
          The verb this exists for is re-execution. Any review bot can re-read a diff; Cujo still
          has the recipe for the sandbox that produced the finding, so the answer to &ldquo;seed the
          database first&rdquo; is a new measurement rather than a rewording of the old one.
        </P>
        <P>
          Both surfaces work, and the answer goes back to whichever one asked — so a question about
          an inline finding is answered under that finding.
        </P>
      </Section>

      <Section id="cannot" title="What it cannot do">
        <UL>
          <LI>
            <strong className="font-medium text-fg">It holds no write tool at all.</strong> Its
            agent is configured with no GitHub access; the service reads the final message and posts
            it. That is what bounds a prompt injection through a stranger&rsquo;s comment to
            &ldquo;wastes a sandbox&rdquo;, and it is also why a run that times out still answers
            you.
          </LI>
          <LI>
            <strong className="font-medium text-fg">It cannot change a verdict.</strong> Asked to,
            it says so and points at{" "}
            <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
              <C>/cujo confirm</C> and <C>/cujo dismiss</C>
            </Link>
            .
          </LI>
          <LI>
            <strong className="font-medium text-fg">It runs in its own session.</strong> Never the
            review&rsquo;s — a question must not be able to cancel a review in flight, and a review
            waiting on a person must still be askable about.
          </LI>
        </UL>
      </Section>

      <Section id="limits" title="Who may ask, and how often">
        <P>
          Write access to the repository, checked with GitHub on every mention, and checked before
          the rate limit. A sandbox is not free speech: answering costs a box. An outside
          contributor is refused out loud, and told that every finding above is readable by anyone —
          reading is public, deciding is not.
        </P>
        <P>
          Three questions per pull request per hour by default, one at a time. A second while one is
          running is refused rather than queued, and every refusal says which of these it was.
        </P>
        <Note>
          What the agent gets is a curated brief — the run&rsquo;s check reports, its findings, the
          posted review body, the head SHA, and your question — not the review session&rsquo;s
          history. Everything in it is already published. Your comment is handed to it as untrusted
          data, explicitly, and never as instructions.
        </Note>
      </Section>
    </>
  );
}
